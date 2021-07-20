/* istanbul ignore next */
if (process.env.NODE_ENV !== 'test') {
  require('source-map-support').install()
}

import { parse as parseUrl, resolve as resolveUrl } from 'url'
import { Parser } from 'htmlparser2'
import fetch from 'cross-fetch'
import UnexpectedError from './unexpectedError'
import { schema, keys } from './schema'
import { Metadata, Opts } from './types'
import { decode as he_decode } from 'he'
import { decode as iconv_decode } from 'iconv-lite'

function unfurl (url: string, opts?: Opts): Promise<Metadata> {
  if (opts === undefined) {
    opts = {}
  }

  if (opts.constructor.name !== 'Object') {
    throw new UnexpectedError(UnexpectedError.BAD_OPTIONS)
  }

  typeof opts.oembed === 'boolean' || (opts.oembed = true)
  typeof opts.compress === 'boolean' || (opts.compress = true)
  typeof opts.userAgent === 'string' || (opts.userAgent = 'facebookexternalhit')

  Number.isInteger(opts.follow) || (opts.follow = 50)
  Number.isInteger(opts.timeout) || (opts.timeout = 0)
  Number.isInteger(opts.size) || (opts.size = 0)

  const ctx: {
    url?: string;
    oembedUrl?: string;
  } = {
    url
  }

  return getPage(url, opts)
    .then(getMetadata(ctx, opts))
    .then(getRemoteMetadata(ctx, opts))
    .then(parse(ctx))
}

async function getPage (url: string, opts: Opts) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html, application/xhtml+xml',
      'User-Agent': opts.userAgent
    },
    // @ts-ignore
    size: opts.size,
    follow: opts.follow,
    timeout: opts.timeout
  })

  const buf = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('Content-Type')
  const contentLength = res.headers.get('Content-Length')

  if (res.status !== 200) {
    throw new UnexpectedError({
      ...UnexpectedError.BAD_HTTP_STATUS,
      info: {
        url,
        httpStatus: res.status
      }
    })
  }

  if (/text\/html|application\/xhtml+xml/.test(contentType) === false) {
    throw new UnexpectedError({
      ...UnexpectedError.EXPECTED_HTML,
      info: {
        url,
        contentType,
        contentLength
      }
    })
  }

  // no charset in content type, peek at response body for at most 1024 bytes
  let str = buf.slice(0, 1024).toString()
  let rg

  if (contentType) {
    rg = /charset=([^;]*)/i.exec(contentType)
  }

  // html 5
  if (!rg && str) {
    rg = /<meta.+?charset=(['"])(.+?)\1/i.exec(str)
  }

  // html 4
  if (!rg && str) {
    rg = /<meta.+?content=["'].+;\s?charset=(.+?)["']/i.exec(str)
  }

  // found charset
  if (rg) {
    const supported = ['CP932', 'CP936', 'CP949', 'CP950', 'GB2312', 'GBK', 'GB18030', 'BIG5', 'SHIFT_JIS', 'EUC-JP']
    const charset = rg.pop().toUpperCase()

    if (supported.includes(charset)) {
      return iconv_decode(buf, charset).toString()
    }
  }

  return buf.toString()
}

function getRemoteMetadata (ctx, opts) {
  return async function (metadata) {
    if (!ctx._oembed) {
      return metadata
    }

    let target = resolveUrl(ctx.url, he_decode(ctx._oembed.href))
    const targeturl = new URL(target)

    let res = await fetch(target)
    let contentType = res.headers.get('Content-Type')
    let contentLength = res.headers.get('Content-Length')
    const status = res.status

    if (status === 403 && targeturl.protocol === 'http:') {
      // try again using HTTPS
      targeturl.protocol = 'https:'
      target = targeturl.href

      res = await fetch(target)
      contentType = res.headers.get('Content-Type')
      contentLength = res.headers.get('Content-Length')
    }

    let ret

    if (ctx._oembed.type === 'application/json+oembed' && /application\/json/.test(contentType)) {
      ret = await res.json()
    } else if (ctx._oembed.type === 'text/xml+oembed' && /(text|application)\/xml/.test(contentType)) {
      let data = await res.text()

      let content: any = {}

      ret = await new Promise((resolve, reject) => {
        const parser = new Parser({
          onopentag: function (name, attribs) {
            if (this._is_html) {
              if (!content.html) {
                content.html = ''
              }

              content.html += `<${name} `
              content.html += Object.keys(attribs)
                .reduce((str, k) => str + (attribs[k] ? `${k}="${attribs[k]}"` : `${k}`) + ' ', '')
                .trim()
              content.html += '>'
            }

            if (name === 'html') {
              this._is_html = true
            }

            this._tagname = name
          },
          ontext: function (text) {
            if (!this._text) this._text = ''
            this._text += text
          },
          onclosetag: function (tagname) {
            if (tagname === 'oembed') {
              return
            }

            if (tagname === 'html') {
              this._is_html = false
              return
            }

            if (this._is_html) {
              content.html += this._text.trim()
              content.html += `</${tagname}>`
            }

            content[tagname] = this._text.trim()

            this._tagname = ''
            this._text = ''
          },
          onend: function () {
            resolve(content)
          }
        })

        parser.write(data)
        parser.end()
      })
    }

    if (!ret) {
      return metadata
    }

    const oEmbedMetadata = Object.keys(ret)
      .map(k => ['oEmbed:' + k, ret[k]])
      .filter(([k, v]) => keys.includes(String(k)))

    metadata.push(...oEmbedMetadata)
    return metadata
  }
}

function getMetadata (ctx, opts: Opts) {
  return function (text) {
    const metadata = []

    return new Promise(resolve => {
      const parser: any = new Parser({
        _nodes_from_root: 0,

        onend: function () {
          if (this._favicon === undefined) {
            metadata.push(['favicon', resolveUrl(ctx.url, '/favicon.ico')])
          } else {
            metadata.push(['favicon', resolveUrl(ctx.url, this._favicon)])
          }

          resolve(metadata)
        },

        onopentagname: function (tag) {
          this._tagname = tag
        },

        ontext: function (text) {
          if (this._tagname === 'title') {
            // makes sure we haven't already seen the title
            if (this._title !== null) {
              if (this._title === undefined) {
                this._title = ''
              }

              this._title += text
            }
          }
        },

        onopentag: function (tagname, attribs) {
          this._nodes_from_root++

          if (opts.oembed && attribs.href) {
            // handle XML and JSON with a preference towards JSON since its more efficient for us
            if (
              tagname === 'link' &&
              (attribs.type === 'text/xml+oembed' || attribs.type === 'application/json+oembed')
            ) {
              if (!ctx._oembed || ctx._oembed.type === 'text/xml+oembed') {
                // prefer json
                ctx._oembed = attribs
              }
            }
          }
          if (tagname === 'link' && attribs.href && (attribs.rel === 'icon' || attribs.rel === 'shortcut icon')) {
            this._favicon = attribs.href
          }

          let pair

          if (tagname === 'meta') {
            if (attribs.name === 'description' && attribs.content) {
              pair = ['description', attribs.content]
            } else if (attribs.name === 'author' && attribs.content) {
              pair = ['author', attribs.content]
            } else if (attribs.name === 'keywords' && attribs.content) {
              let keywords = attribs.content
                .replace(/^[,\s]{1,}|[,\s]{1,}$/g, '') // gets rid of trailing space or sommas
                .split(/,{1,}\s{0,}/) // splits on 1+ commas followed by 0+ spaces

              pair = ['keywords', keywords]
            } else if (attribs.property && keys.includes(attribs.property)) {
              pair = [attribs.property, attribs.content]
            } else if (attribs.name && keys.includes(attribs.name)) {
              pair = [attribs.name, attribs.content]
            }
          }

          if (pair) {
            metadata.push(pair)
          }
        },

        onclosetag: function (tag) {
          this._nodes_from_root--
          this._tagname = ''

          if (this._nodes_from_root <= 2 && tag === 'title') {
            metadata.push(['title', this._title])
            this._title = ''
          }

          // We want to parse as little as possible so finish once we see </head>
          // if we have not seen a title tag within the head, we scan the entire
          // document instead
          if (tag === 'head' && this._title) {
            parser.reset()
          }
        }
      })

      parser.write(text)
      parser.end()
    })
  }
}

function parse (ctx) {
  return function (metadata) {
    const parsed: any = {}

    let tags = []
    let lastParent

    for (let [metaKey, metaValue] of metadata) {
      const item = schema.get(metaKey)

      // decoding html entities
      if (typeof metaValue === 'string') {
        metaValue = he_decode(he_decode(metaValue.toString()))
      } else if (Array.isArray(metaValue)) {
        metaValue = metaValue.map(val => he_decode(he_decode(val)))
      }

      if (!item) {
        parsed[metaKey] = metaValue
        continue
      }

      // special case for video tags which we want to map to each video object
      if (metaKey === 'og:video:tag') {
        tags.push(metaValue)
        continue
      }

      if (item.type === 'number') {
        metaValue = parseInt(metaValue, 10)
      } else if (item.type === 'url' && metaValue) {
        metaValue = resolveUrl(ctx.url, metaValue)
      }

      if (parsed[item.entry] === undefined) {
        parsed[item.entry] = {}
      }

      let target = parsed[item.entry]

      if (item.parent) {
        if (item.category) {
          if (!target[item.parent]) {
            target[item.parent] = {}
          }

          if (!target[item.parent][item.category]) {
            target[item.parent][item.category] = {}
          }

          target = target[item.parent][item.category]
        } else {
          if (Array.isArray(target[item.parent]) === false) {
            target[item.parent] = []
          }

          if (!target[item.parent][target[item.parent].length - 1]) {
            target[item.parent].push({})
          } else if (
            (!lastParent || item.parent === lastParent) &&
            target[item.parent][target[item.parent].length - 1] &&
            target[item.parent][target[item.parent].length - 1][item.name]
          ) {
            target[item.parent].push({})
          }

          lastParent = item.parent
          target = target[item.parent][target[item.parent].length - 1]
        }
      }

      // some fields map to the same name so once nicwe have one stick with it
      target[item.name] || (target[item.name] = metaValue)
    }

    if (tags.length && parsed.open_graph.videos) {
      parsed.open_graph.videos = parsed.open_graph.videos.map(obj => ({
        ...obj,
        tags
      }))
    }

    return parsed
  }
}

export { unfurl }
