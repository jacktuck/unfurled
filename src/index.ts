import 'source-map-support/register'

import {
  parse as parseUrl,
  resolve as resolveUrl
} from 'url'

import { Parser } from 'htmlparser2'

import * as iconv from 'iconv-lite'
import fetch from 'node-fetch'
import UnexpectedError from './UnexpectedError'
import {
  schema,
  keys
} from './schema'

type Opts = {
  /** support retreiving oembed metadata */
  oembed ? : boolean
  /** req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies) */
  timeout ? : number
  /** maximum redirect count. 0 to not follow redirect */
  follow ? : number
  /** support gzip/deflate content encoding */
  compress ? : boolean
  /** maximum response body size in bytes. 0 to disable */
  size ? : number
  /** http(s).Agent instance, allows custom proxy, certificate, lookup, family etc. */
  agent ? : string | null
}

function unfurl(url: string, opts ? : Opts) {
  if (opts === undefined || opts.constructor.name !== 'Object') {
    opts = {}
  }

  // Setting defaults when not provided or not correct type
  typeof opts.oembed === 'boolean' || (opts.oembed = true)
  typeof opts.compress === 'boolean' || (opts.compress = true)
  typeof opts.agent === 'string' || (opts.agent = 'facebookexternalhit')

  Number.isInteger(opts.follow) || (opts.follow = 50)
  Number.isInteger(opts.timeout) || (opts.timeout = 0)
  Number.isInteger(opts.size) || (opts.size = 0)

  console.log('OPTS', opts)

  // console.log('opts', opts)
  const ctx: {
    url ? : string,
    oembedUrl ? : string
  } = {
    url
  }

  return getPage(url, opts)
    .then(getLocalMetadata(ctx, opts))
    .then(getRemoteMetadata(ctx, opts))
    .then(parse(ctx))
}

async function getPage(url: string, opts: Opts) {
  const resp = await fetch(url, {
    headers: {
      Accept: 'text/html, application/xhtml+xml',
      agent: opts.agent
    },
    timeout: opts.timeout,
    follow: opts.follow,
    compress: opts.compress,
    size: opts.size,
  })
  
  const buf = await resp.buffer()
  const ct = resp.headers.get('Content-Type')

  if (/text\/html|application\/xhtml+xml/.test(ct) === false) {
    throw new UnexpectedError(UnexpectedError.EXPECTED_HTML)
  }

	// no charset in content type, peek at response body for at most 1024 bytes
	let str = buf.slice(0, 1024).toString()
  let res

  if (ct) {
		res = /charset=([^;]*)/i.exec(ct);
  }

	// html5
	if (!res && str) {
		res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
	}

  // html4
	if (!res && str) {
		res = /<meta.+?content=["'].+;\s?charset=(.+?)["']/i.exec(str);
  }

	// found charset
	if (res) {
    const supported = [ 'CP932', 'CP936', 'CP949', 'CP950', 'GB2312', 'GBK', 'GB18030', 'BIG5', 'SHIFT_JIS', 'EUC-JP' ]
    const charset = res.pop().toUpperCase()

    if (supported.includes(charset)) {
      return iconv.decode(buf, charset).toString()
    }
  }

  return buf.toString()
}

function getLocalMetadata(ctx, opts: Opts) {
  return function (text) {
    console.log('TEXT!', text)
    const metadata = []

    return new Promise((resolve, reject) => {
      const parser = new Parser({}, {
        decodeEntities: true
      })

      function onend() {
        console.log('END!!!')

        if (this._favicon !== null) {
          const favicon = resolveUrl(ctx.url, '/favicon.ico')
          metadata.push(['favicon', favicon])
        }

        resolve(metadata)
      }

      function onreset() {
        console.log('RESET!!!')
        resolve(metadata)
      }

      function onerror(err) {
        console.log('ERR!!!', err)
        reject(err)
      }

      function onopentagname(tag) {
        this._tagname = tag
      }

      function ontext(text) {
        if (this._tagname === 'title') {
          // Makes sure we haven't already seen the title
          if (this._title !== null) {
            if (this._title === undefined) {
              this._title = ''
            }

            this._title += text
          }
        }
      }

      function onopentag(name, attr) {
        if (opts.oembed && attr.type === 'application/json+oembed' && attr.href) {
          // If url is relative we will make it absolute
          ctx.oembedUrl = resolveUrl(ctx.url, attr.href)
          return
        }

        const prop = attr.name || attr.property || attr.rel
        const val = attr.content || attr.value

        console.log('NAME', name)
        console.log('ATTR', attr)
        console.log('PROP', prop)
        console.log('VAL', val)

        if (this._favicon !== null) {
          let favicon

          // If url is relative we will make it absolute
          if (attr.rel === 'shortcut icon') {
            favicon = resolveUrl(ctx.url, attr.href)
          } else if (attr.rel === 'icon') {
            favicon = resolveUrl(ctx.url, attr.href)
          }

          if (favicon) {
            metadata.push(['favicon', favicon])
            this._favicon = null
          }
        }

        // console.log('prop', prop)
        if (prop === 'description') {
          metadata.push(['description', val])
        }

        if (prop === 'keywords') {
          metadata.push(['keywords', val])
        }

        if (!prop ||
          !val ||
          keys.includes(prop) === false
        ) {
          console.log('IGNORED')
          return
        }

        metadata.push([prop, val])
      }

      function onclosetag(tag) {
        this._tagname = ''

        // if (tag === 'head') {
        //   parser.reset()
        // }

        if (tag === 'title' && this._title !== null) {
          metadata.push(['title', this._title])
          this._title = null
        }
      }

      parser._cbs = {
        onopentag,
        ontext,
        onclosetag,
        onend,
        onreset,
        onerror,
        onopentagname
      }

      parser.write(text)
      parser.end()
    })
  }
}

// const encodings = [ 'CP932', 'CP936', 'CP949', 'CP950', 'GB2312', 'GBK', 'GB18030', 'Big5', 'Shift_JIS', 'EUC-JP' ]


function getRemoteMetadata(ctx, opts: Opts) {
  return async function (metadata) {
    if (!opts.oembed || !ctx.oembedUrl) {
      return metadata
    }

    const res = await fetch(ctx.oembedUrl)

    let ct = res.headers.get('Content-Type')

    // If we're not getting JSON back then return early
    if (/application\/json/.test(ct) === false) {
      return metadata
    }

    const data = await res.json()
   
    const oEmbed = Object.entries(data)
      .map(([k, v]) => ['oEmbed:' + k, v])
      .filter(([k, v]) => keys.includes(String(k))) // to-do: look into why TS complains if i don't String()

    metadata.push(...oEmbed)

    return metadata
  }
}

function parse(ctx) {
  return function (metadata) {
    console.log('CTZZZ', ctx)

    const parsed = {
      twitter_card: {},
      open_graph: {},
      oEmbed: {}
    }

    let tags = []
    let lastParent

    for (let [metaKey, metaValue] of metadata) {
      const item = schema.get(metaKey)
      console.log('KEY', metaKey)
      console.log('ITEM', item)

      if (!item) {
        parsed[metaKey] = metaValue
        continue
      }

      // Special case for video tags which we want to map to each video object
      if (metaKey === 'og:video:tag') {
        // console.log('pushing tag', metaValue)
        tags.push(metaValue)

        continue
      }

      if (item.type === 'string') {
        metaValue = metaValue.toString()
      } else if (item.type === 'number') {
        metaValue = parseInt(metaValue)
      } else if (item.type === 'url') {
        metaValue = resolveUrl(ctx.url, metaValue)
      }

      // convert value if we need to

      let target = parsed[item.entry]
      // console.log('TARGET', target)
      if (Array.isArray(target)) {
        if (!target[target.length - 1]) {
          target.push({})
        }

        target = target[target.length - 1]
      }

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
          } else if ((!lastParent || item.parent === lastParent) && target[item.parent][target[item.parent].length - 1] && target[item.parent][target[item.parent].length - 1][item.name]) {
            target[item.parent].push({})
          }

          lastParent = item.parent
          target = target[item.parent][target[item.parent].length - 1]
        }
      }
      // some fields map to the same name so once we have one stick with it
      target[item.name] || (target[item.name] = metaValue)
    }

    if (tags.length && parsed.open_graph['videos']) {
      // console.log('adding tag arr')
      parsed.open_graph['videos'] = parsed.open_graph['videos'].map(obj => ({ ...obj,
        tags
      }))
    }

    // console.log('PARSED', '\n', JSON.stringify(parsed, null, 2))
    return parsed
  }
}

module.exports = unfurl