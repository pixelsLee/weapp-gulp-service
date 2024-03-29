const path = require('path')
const through2 = require('through2')
const vinyl = require('vinyl')
const camelcase = require('camelcase')
const dashify = require('dashify')
const { loadAndResolveLessVars } = require('../utils/less-var-to-js')

function norStr(s) {
    return s.replace(/\\"/g, "'").replace(/"/g, '')
}

// less var > js obj + css var
module.exports = function () {
    return through2.obj(function (file, enc, done) {
        if (file.isNull()) {
            return done(null, file)
        }

        const { sourceDir } = file.context

        var fileName = path.basename(file.path, '.less')

        // parse var.less
        loadAndResolveLessVars(file.path)
            .then((vars) => {
                // jsVar
                this.push(
                    new vinyl({
                        base: sourceDir,
                        path: path.join(file.path, '..', fileName + '.js'),
                        contents: Buffer.from(
                            `export default ${JSON.stringify(
                                Object.entries(vars).reduce((acc, v) => {
                                    acc[camelcase(v[0])] = v[1]

                                    return acc
                                }, {})
                            )}`
                        ),
                        context: file.context,
                    })
                )

                // cssVar
                this.push(
                    new vinyl({
                        base: sourceDir,
                        path: path.join(file.path, '..', fileName + '.wxss'),
                        contents: Buffer.from(
                            `page {${Object.entries(vars).reduce((acc, v) => {
                                acc += `--${dashify(v[0])}: ${v[1]};`

                                return acc
                            }, '')}}`
                        ),
                        context: file.context,
                    })
                )
            })
            // @bugfix 移除全局less文件的依赖模块对其的依赖
            .then(() => {
                let context = file.context

                context.tap('afterCompile', function ({ next }) {
                    let node = context.getGraphNode(file),
                        lessVarId = node.path

                    function removeLessVar(node) {
                        node.dependencies.forEach((cid) => {
                            let child = context.getGraphNodeById(cid)
                            context.removeDep(cid, lessVarId)

                            if (child) removeLessVar(child)
                        })
                    }

                    if (node) {
                        removeLessVar(node)
                    }

                    next()
                })

                done()
            })
    })
}
