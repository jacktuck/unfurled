"use strict";
// to-do: rather than remembering once we have a title. We should wipe
// the title state when we see title tag opened, so we only keep latest title.
// e.g.:
// <title>foo</title>
// <title>bar</title>
// we should take title as 'bar' not 'foo'
Object.defineProperty(exports, "__esModule", { value: true });
// ts-jest already adds source-maps so we don't want to add them again during tests
if (!process.env.disable_source_map) {
    require('source-map-support').install();
}
const url_1 = require("url");
const htmlparser2_1 = require("htmlparser2");
const iconv = require("iconv-lite");
const node_fetch_1 = require("node-fetch");
const unexpectedError_1 = require("./unexpectedError");
const schema_1 = require("./schema");
function unfurl(url, opts) {
    // console.log('unfurl -> url', url)
    // console.log('unfurl -> opts', opts)
    if (opts === undefined) {
        opts = {};
    }
    if (opts.constructor.name !== 'Object') {
        //  console.log('ABOUT TO THROW')
        throw new unexpectedError_1.default(unexpectedError_1.default.BAD_OPTIONS);
    }
    // console.log('STILL GOIN')
    // Setting defaults when not provided or not correct type
    typeof opts.oembed === 'boolean' || (opts.oembed = true);
    typeof opts.compress === 'boolean' || (opts.compress = true);
    typeof opts.agent === 'string' || (opts.agent = 'facebookexternalhit');
    Number.isInteger(opts.follow) || (opts.follow = 50);
    Number.isInteger(opts.timeout) || (opts.timeout = 0);
    Number.isInteger(opts.size) || (opts.size = 0);
    // console.log('OPTS', opts)
    // console.log('opts', opts)
    const ctx = {
        url
    };
    return getPage(url, opts)
        .then(getMetadata(ctx, opts))
        .then(getRemoteMetadata(ctx, opts))
        .then(parse(ctx));
}
async function getPage(url, opts) {
    const resp = await node_fetch_1.default(url, {
        headers: {
            Accept: 'text/html, application/xhtml+xml',
            agent: opts.agent
        },
        timeout: opts.timeout,
        follow: opts.follow,
        compress: opts.compress,
        size: opts.size
    });
    const buf = await resp.buffer();
    const ct = resp.headers.get('Content-Type');
    // console.log('ct', ct)
    if (/text\/html|application\/xhtml+xml/.test(ct) === false) {
        throw new unexpectedError_1.default(unexpectedError_1.default.EXPECTED_HTML);
    }
    // no charset in content type, peek at response body for at most 1024 bytes
    let str = buf.slice(0, 1024).toString();
    let res;
    if (ct) {
        // console.log('detecting charset from content-type header')
        res = /charset=([^;]*)/i.exec(ct);
        // console.log('detected', res)
    }
    // html 5
    if (!res && str) {
        // console.log('detecting charset from <meta> in html5')
        res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
        // console.log('detected', res)
    }
    // html 4
    if (!res && str) {
        // console.log('detecting charset from <meta> in html4')
        res = /<meta.+?content=["'].+;\s?charset=(.+?)["']/i.exec(str);
        // console.log('detected', res)
    }
    // found charset
    if (res) {
        // console.log('BUFFER WAS DETECTED AS', jschardet.detect(buf))
        const supported = ['CP932', 'CP936', 'CP949', 'CP950', 'GB2312', 'GBK', 'GB18030', 'BIG5', 'SHIFT_JIS', 'EUC-JP'];
        const charset = res.pop().toUpperCase();
        // console.log('charset', charset)
        if (supported.includes(charset)) {
            // console.log('converting charset...', charset)
            return iconv.decode(buf, charset).toString();
        }
    }
    return buf.toString();
}
function getRemoteMetadata(ctx, opts) {
    return async function (metadata) {
        console.log('getRemoteMetadata', ctx._oembed);
        if (!ctx._oembed) {
            return metadata;
        }
        const target = url_1.resolve(ctx.url, ctx._oembed.href);
        const res = await node_fetch_1.default(target);
        const ct = res.headers.get('Content-Type');
        let ret;
        if (ctx._oembed.type === 'application/json+oembed') {
            ret = await res.json();
        }
        else if (ctx._oembed.type === 'text/xml+oembed') {
            let data = await res.text();
            let rez = {};
            let _tagname = '';
            let _text = '';
            ret = await new Promise((resolve, reject) => {
                const parser = new htmlparser2_1.Parser({
                    onopentag: function (name, attribs) {
                        console.log('TAG', { name, attribs });
                        _tagname = name;
                    },
                    ontext: function (text) {
                        console.log('TEXT', { text });
                        if (!_text)
                            _text = '';
                        _text += text;
                    },
                    onclosetag: function (tagname) {
                        console.log('CLOSE TAG', { tagname });
                        if (tagname === 'oembed') {
                            return;
                        }
                        rez[_tagname] = _text.trim();
                        _tagname = '';
                        _text = '';
                    },
                    onend: function () {
                        console.log('END!');
                        resolve(rez);
                    },
                    onerror: function (err) {
                        console.log('ERR!');
                        reject(err);
                    }
                });
                parser.write(data);
                parser.end();
            });
        }
        console.log('RET', ret);
        const oEmbedMetadata = Object.entries(ret)
            .map(([k, v]) => ['oEmbed:' + k, v])
            .filter(([k, v]) => schema_1.keys.includes(String(k))); // to-do: look into why TS complains if i don't String()
        console.log('oEmbedMetadata', oEmbedMetadata);
        metadata.push(...oEmbedMetadata);
        return metadata;
    };
}
function getMetadata(ctx, opts) {
    return function (text) {
        // console.log('TEXT!', text)
        const metadata = [];
        return new Promise((resolve, reject) => {
            const parser = new htmlparser2_1.Parser({}, {
                decodeEntities: true
            });
            function onend() {
                console.log('END!!!');
                if (this._favicon !== null) {
                    const favicon = url_1.resolve(ctx.url, '/favicon.ico');
                    metadata.push(['favicon', favicon]);
                }
                resolve(metadata);
            }
            function onreset() {
                console.log('RESET!!!');
                // resolve(metadata)
            }
            function onerror(err) {
                // console.log('ERR!!!', err)
                reject(err);
            }
            function onopentagname(tag) {
                this._tagname = tag;
            }
            function ontext(text) {
                if (this._tagname === 'title') {
                    // Makes sure we haven't already seen the title
                    if (this._title !== null) {
                        if (this._title === undefined) {
                            this._title = '';
                        }
                        this._title += text;
                    }
                }
            }
            function onopentag(name, attr) {
                // console.log('onopentag!!!!!!', name, attr)
                if (opts.oembed && attr.href) {
                    // We will handle XML and JSON with a preference towards JSON since its more efficient for us
                    if (attr.type === 'text/xml+oembed' || attr.type === 'application/json+oembed') {
                        if (!ctx._oembed || ctx._oembed === 'application/json+oembed') {
                            ctx._oembed = attr;
                        }
                    }
                }
                const prop = attr.name || attr.property || attr.rel;
                const val = attr.content || attr.value;
                // console.log('NAME', name)
                // console.log('ATTR', attr)
                // console.log('PROP', prop)
                // console.log('VAL', val)
                if (this._favicon !== null) {
                    let favicon;
                    // If url is relative we will make it absolute
                    if (attr.rel === 'shortcut icon') {
                        favicon = url_1.resolve(ctx.url, attr.href);
                    }
                    else if (attr.rel === 'icon') {
                        favicon = url_1.resolve(ctx.url, attr.href);
                    }
                    if (favicon) {
                        metadata.push(['favicon', favicon]);
                        this._favicon = null;
                    }
                }
                // console.log('prop', prop)
                if (prop === 'description') {
                    metadata.push(['description', val]);
                }
                if (prop === 'keywords') {
                    metadata.push(['keywords', val]);
                }
                if (!prop ||
                    !val ||
                    schema_1.keys.includes(prop) === false) {
                    // console.log('IGNORED')
                    return;
                }
                metadata.push([prop, val]);
            }
            function onclosetag(tag) {
                this._tagname = '';
                // We want to parse as little as possible so finish once we see </head>
                if (tag === 'head') {
                    parser.reset();
                }
                if (tag === 'title' && this._title !== null) {
                    metadata.push(['title', this._title]);
                    this._title = null;
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
            };
            parser.write(text);
            parser.end();
        });
    };
}
function parse(ctx) {
    return function (metadata) {
        // console.log('CTZZZ', ctx)
        console.log('PARSING!', metadata);
        const parsed = {
            twitter_card: {},
            open_graph: {},
            oEmbed: {}
        };
        let tags = [];
        let lastParent;
        for (let [metaKey, metaValue] of metadata) {
            const item = schema_1.schema.get(metaKey);
            // console.log('KEY', metaKey)
            // console.log('ITEM', item)
            if (!item) {
                parsed[metaKey] = metaValue;
                continue;
            }
            // Special case for video tags which we want to map to each video object
            if (metaKey === 'og:video:tag') {
                // console.log('pushing tag', metaValue)
                tags.push(metaValue);
                continue;
            }
            if (item.type === 'string') {
                metaValue = metaValue.toString();
            }
            else if (item.type === 'number') {
                metaValue = parseInt(metaValue, 10);
            }
            else if (item.type === 'url') {
                metaValue = url_1.resolve(ctx.url, metaValue);
            }
            let target = parsed[item.entry];
            // console.log('TARGET', target)
            if (Array.isArray(target)) {
                if (!target[target.length - 1]) {
                    target.push({});
                }
                target = target[target.length - 1];
            }
            if (item.parent) {
                if (item.category) {
                    if (!target[item.parent]) {
                        target[item.parent] = {};
                    }
                    if (!target[item.parent][item.category]) {
                        target[item.parent][item.category] = {};
                    }
                    target = target[item.parent][item.category];
                }
                else {
                    if (Array.isArray(target[item.parent]) === false) {
                        target[item.parent] = [];
                    }
                    if (!target[item.parent][target[item.parent].length - 1]) {
                        target[item.parent].push({});
                    }
                    else if ((!lastParent || item.parent === lastParent) && target[item.parent][target[item.parent].length - 1] && target[item.parent][target[item.parent].length - 1][item.name]) {
                        target[item.parent].push({});
                    }
                    lastParent = item.parent;
                    target = target[item.parent][target[item.parent].length - 1];
                }
            }
            // some fields map to the same name so once nicwe have one stick with it
            target[item.name] || (target[item.name] = metaValue);
        }
        if (tags.length && parsed.open_graph['videos']) {
            // console.log('adding tag arr')
            parsed.open_graph['videos'] = parsed.open_graph['videos'].map(obj => (Object.assign({}, obj, { tags })));
        }
        // console.log('PARSED', '\n', JSON.stringify(parsed, null, 2))
        return parsed;
    };
}
exports.default = unfurl;
//# sourceMappingURL=index.js.map