const { src } = require('gulp')
const { fixture, minify, stream } = require('~h')
const compilerContext = require('~f/compiler-context')
//
const gulpContext = require('internal/gulp-context')
const gulpWxss = require('internal/gulp-wxss')
//
let context = {}

describe('gulp-wxss', function () {
    beforeEach(function () {
        // reset
        context = compilerContext()
    })

    it('trans', function (done) {
        src([fixture('wxss/login.wxss')])
            .pipe(gulpContext(context))
            .pipe(gulpWxss(context.options))
            .pipe(
                stream(function (file, enc, cb) {
                    return minify('css', file.contents.toString('utf8'))
                        .then((code) => {
                            // alias
                            code.should.include(`@import url(base.wxss);`)
                            // base64
                            code.should.include(
                                `.login{background:url(data:image/png;base64`
                            )
                            // normal
                            code.should.include(`.login-btn{font-size:16px}`)

                            done()
                        })
                        .catch((err) => done(err))
                        .finally(() => cb(null, file))
                })
            )
    })
})
