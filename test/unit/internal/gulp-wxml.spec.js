const { src } = require('gulp')
const { minify, fixture, stream } = require('~h')
const compilerSession = require('~f/compiler-session')
//
const gulpContext = require('internal/gulp-context')
const gulpWxml = require('internal/gulp-wxml')
//
let context = {}

describe('gulp-wxml', function () {
    beforeEach(function () {
        // reset
        session = compilerSession()
    })

    it('trans', function (done) {
        src([fixture('wxml/index.wxml')])
            .pipe(gulpContext(session))
            .pipe(gulpWxml(session.options))
            .pipe(
                stream(function (file, enc, cb) {
                    minify('html', file.contents.toString('utf8'), {
                        minifyCSS: false,
                    })
                        .then((code) => {
                            code.should.equal(
                                '<view><image class="cover" style="width: {{ realWidth }}px; height: {{ realHeight }}px" src="../img/big.jpg"></image></view>'
                            )
                            done()
                        })
                        .catch((e) => {
                            done(e)
                        })
                        .finally(() => cb())
                })
            )
    })
})
