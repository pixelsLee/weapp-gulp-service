const htmlparser2 = require('htmlparser2')
const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
const stripParensRE = /^\(|\)$/g

// v-for解析
function parseFor(exp) {
    // inMatch[1] in inMatch[2]
    const inMatch = exp.match(forAliasRE)
    if (!inMatch) return
    const res = {}
    // $obj
    res.for = inMatch[2].trim()
    // $item, $name, $index
    const alias = inMatch[1].trim().replace(stripParensRE, '')
    const iteratorMatch = alias.match(forIteratorRE)
    if (iteratorMatch) {
        // $item
        res.alias = alias.replace(forIteratorRE, '').trim()
        // $name
        res.iterator1 = iteratorMatch[1].trim()
        if (iteratorMatch[2]) {
            // $index
            res.iterator2 = iteratorMatch[2].trim()
        }
    } else {
        res.alias = alias
    }
    return res
}

class SfcParser extends htmlparser2.Parser {
    constructor(options = {}) {
        let { tagAlias = {} } = options
        let parser,
            handler = {
                onopentag(tagName, attributes) {
                    if (parser.level === 0) {
                        parser.root = tagName
                        parser.rootAttrs = attributes
                    }

                    parser.level++

                    if (parser.root === 'template' && parser.level > 1) {
                        let attrs = ''

                        // From: v-for="(item, index) in arr"
                        // to:   wx:for="{{ arr }}" wx:for-index="index" wx:for-item="item"
                        if (attributes['v-for']) {
                            let vfor = attributes['v-for']
                            delete attributes['v-for']
                            delete attributes['wx:for']
                            delete attributes['wx:for-item']
                            delete attributes['wx:for-index']

                            vfor = parseFor(vfor)
                            if (vfor.for) {
                                attrs += ` wx:for="{{ ${vfor.for} }}"`
                                if (vfor.alias && vfor.alias !== 'item') {
                                    attrs += ` wx:for-item="{{ ${vfor.alias} }}"`
                                }
                                if (
                                    vfor.iterator1 &&
                                    vfor.iterator1 !== 'index'
                                ) {
                                    attrs += ` wx:for-index="{{ ${vfor.iterator1} }}"`
                                }
                            }
                        }

                        Object.entries(attributes).forEach(([name, value]) => {
                            // :key="item.id" -> wx:key="id"
                            if (name === ':key') {
                                name = 'wx:key'
                                value = value.split('.')
                                value = value[value.length - 1]
                            }
                            // :prop="value" -> prop="{{ value }}"
                            else if (name.startsWith(':')) {
                                name = name.slice(1)
                                value = '{{ ' + value.trim() + ' }}'
                            }
                            // @event="handler" -> bind:event="handler"
                            // @event.stop="handdler" -> catch:event="handler"
                            // @event.capture="handdler" -> capture-bind:event="handler"
                            // @event.mut="handdler" -> mut-bind:event="handler"
                            // 支持组合 @event.stop.capture，但一旦出现 mut, 则只能是 mut-bind:
                            else if (name.startsWith('@')) {
                                name = name.slice(1)
                                let sep = name.indexOf('.'),
                                    modifier = {}
                                if (sep >= 0) {
                                    modifier = name.slice(sep + 1)
                                    name = name.slice(0, sep)
                                    // prettier-ignore
                                    if(modifier) modifier = modifier.split('.').reduce((acc, k) => (acc[k]=true, acc),{})
                                }
                                if (modifier.mut) name = 'mut-bind:' + name
                                else {
                                    if (modifier.stop) name = 'catch:' + name
                                    else name = 'bind:' + name
                                    // prettier-ignore
                                    if (modifier.capture) name = 'capture-' + name
                                }
                            }
                            // directives
                            else if (name.startsWith('v-')) {
                                // v-show="exp" -> hidden="{{ exp === false }}"
                                if (name === 'v-show') {
                                    name = 'hidden'
                                    value = '{{ ' + value + ' === false }}'
                                }
                                // v-if="exp" -> wx:if="{{ exp }}"
                                else if (name === 'v-if') {
                                    name = 'wx:if'
                                    value = '{{ ' + value + ' }}'
                                }
                                // v-else-if="exp" -> wx:elif="{{ exp }}"
                                else if (name === 'v-else-if') {
                                    name = 'wx:elif'
                                    value = '{{ ' + value + ' }}'
                                }
                                // v-else -> wx:else
                                else if (name === 'v-else') {
                                    name = 'wx:else'
                                    value = ''
                                }
                            }
                            // join
                            if (value) {
                                attrs += ` ${name}="${value}"`
                            } else {
                                attrs += ' ' + name
                            }
                        })
                        // 元素别名
                        if (tagAlias[tagName]) {
                            tagName = tagAlias[tagName]
                        }
                        parser.wxml += `<${tagName}${attrs}>`
                    }
                },
                ontext(text) {
                    if (parser.root === 'script') {
                        if (parser.rootAttrs.name === 'json') {
                            // json取最后一个
                            parser.json = text.trim()
                        } else {
                            parser.js += text.trimLeft()
                        }
                    } else if (parser.root === 'style') {
                        let lang = parser.rootAttrs.lang || 'css'
                        parser.style.push({
                            lang,
                            text: text.trim(),
                        })
                    } else if (parser.root === 'template') {
                        parser.wxml += text
                    }
                },
                onclosetag(tagName) {
                    if (parser.root === 'template' && parser.level > 1) {
                        if (tagAlias[tagName]) {
                            tagName = tagAlias[tagName]
                        }
                        parser.wxml += `</${tagName}>`
                    }
                    parser.level--
                    if (parser.level === 0) {
                        parser.root = ''
                        parser.rootAttrs = null
                    }
                },
                oncomment(data) {
                    parser.wxml += `<!--${data}`
                },
                oncommentend() {
                    parser.wxml += '-->'
                },
            }

        super(handler, {
            lowerCaseTags: false,
            lowerCaseAttributeNames: false,
            recognizeSelfClosing: true,
        })

        parser = this

        this.root = '' // 当前根节点
        this.rootAttrs = null
        this.level = 0

        this.wxml = ''
        this.js = ''
        this.json = ''
        this.style = []
    }
}

module.exports = SfcParser
