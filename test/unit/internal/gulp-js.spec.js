const { src } = require('gulp')
const { fixture, stream } = require('~h')
const compilerSession = require('~f/compiler-session')
//
const gulpContext = require('internal/gulp-context')
const gulpJs = require('internal/gulp-js')
//
let context = {}

describe('gulp-js', function () {
    beforeEach(function () {
        // reset
        session = compilerSession()
    })

    it('trans', function (done) {
        src([fixture('js/a.js')])
            .pipe(gulpContext(session))
            .pipe(gulpJs(session.options))
            .pipe(
                stream(function (file, enc, cb) {
                    try {
                        var contents = file.contents.toString('utf8')

                        // alias
                        contents.should.include(`import { read } from 'b'`)
                        // env
                        contents.should.include(`return read("/" + name)`)

                        done()
                    } catch (e) {
                        done(e)
                    }
                    cb()
                })
            )
    })
})
