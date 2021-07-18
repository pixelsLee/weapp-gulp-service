// 3rd
const fs = require('fs')
const path = require('path')
const Events = require('events')
const combine = require('multipipe')
const ansiColors = require('ansi-colors')
const connector = require('../utils/connector')
// utils
const rqp = require('./require-piper')
const progress = require('./progress')
const resolveOptions = require('../config')
const internalTasks = require('../config/tasks')
const { queueTask } = require('../utils/scheduler')
const {
    runQueue,
    toGlobPath,
    type,
    resolveNpmList,
    log,
    statsFilesNum,
    groupBy,
} = require('../utils/helper')
// gulp-plugins
const gulp = require('gulp')
const { src, dest, series, parallel, watch } = gulp
const gulpIf = require('gulp-if')
const gulpProgress = rqp('gulp-progress')
const gulpFileContext = rqp('gulp-file-context')
const gulpCompileCache = rqp('gulp-compile-cache')
// watchers
const sourceWatcher = require('./watcher/source-watcher')
const pkgWatcher = require('./watcher/pkg-watcher')
// global
const plugins = [],
    hooks = {
        init: [],
        clean: [],
        beforeCompile: [],
        afterCompile: [],
    },
    invokeHook = (compiler, name, event = {}) => {
        const handlers = hooks[name]

        if (handlers.length) {
            return runQueue.promise(handlers, (fn, next) =>
                fn.call(compiler, {
                    ...event,
                    next,
                })
            )
        } else {
            return Promise.resolve()
        }
    },
    pkgInfo = require('../../package.json') // 包信息

// 打印错误日志
function logError(err) {
    progress.stop()
    // 隐藏进度条
    log((err.error || err).toString())
}

// 编译器
class Compiler extends Events {
    constructor(options) {
        super()
        // state
        this.options = resolveOptions(options)
        // validation
        if (!this.options.output) {
            throw new Error('outputDir is required')
        }
        this._inited = this._init()
    }
    // 初始化
    _init() {
        // 运行中
        this.running = false
        // 编译中
        this.compiling = false
        // 基路径（实际的cwd）
        this.baseDir = this.options.baseDir = path.dirname(this.options.config)
        // 缓存目录
        // prettier-ignore
        this.cacheDir = this.options.cacheDir = path.resolve(this.baseDir, '.wgs')
        // 输入目录
        // prettier-ignore
        this.sourceDir = this.options.sourceDir = path.resolve(this.baseDir, this.options.source)
        // 输出
        // prettier-ignore
        this.outputDir = this.options.outputDir = path.resolve(this.baseDir, this.options.output)
        // npm构建配置
        this.npmList = this.options.npmList = resolveNpmList(this.options)
        // 版本号
        this._version = pkgInfo.version

        // normalize alias
        const { alias } = this.options
        if (alias) {
            Object.keys(alias).forEach((k) => {
                alias[k] = path.resolve(this.baseDir, alias[k])
            })
        }

        // 创建缓存目录
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir)
        }

        // private data
        this._db = connector({
            dir: this.cacheDir,
        })
        this._watchers = []
        this._userTasks = {}
        this._internalTasks = {}

        // init hooks
        return invokeHook(this, 'init')
    }
    // 标准化任务配置对象
    _normalizeTaskConfig(config) {
        // 自定义函数
        if (typeof config === 'function') {
            return config
        }

        var {
            test,
            use,
            compileAncestor = false, // 是否联动更新上游模块
            cache = true, // 是否缓存
            output = true, // 是否输出
        } = config
        var sourceDir = this.sourceDir

        // required validation
        if (!test) {
            throw new Error(`test is required. ${JSON.stringify(config)}`)
        }
        if (!use) {
            throw new Error(`use is required. ${JSON.stringify(config)}`)
        }

        if (typeof test === 'function') {
            test = test(this.options)
        }
        // 统一添加sourceDir前缀
        if (type(test) !== 'array') {
            test = [test]
        }
        test = test.map((v) => toGlobPath(path.resolve(sourceDir, v)))

        // use: []
        if (type(use) !== 'array') {
            use = [use]
        }
        // use: [[name, options]]
        use.forEach((v, i) => {
            if (type(v) !== 'array') {
                use[i] = [v]
            }
            if (!use[i][1]) {
                use[i][1] = this.options
            } else if (typeof use[i][1] === 'function') {
                use[i][1] = use[i][1](this.options)
            }
        })

        return {
            test,
            use,
            compileAncestor,
            cache,
            output,
        }
    }
    // 标准化任务配置
    _normalizeTasks(tasks) {
        return Object.entries(tasks).reduce((acc, v) => {
            var [name, config] = v
            acc[name] = this._normalizeTaskConfig(config)
            return acc
        }, {})
    }
    // 设置编译上下文
    _setCompileContext() {
        let compileContext = {},
            keys = [
                // props
                ...Object.keys(this),
                // plugin methods
                ...Object.keys(Object.getPrototypeOf(this)),
                // internal methods
                'wgsResolve',
                'createFileContext',
            ],
            c = this

        keys.forEach((k) => {
            let v = c[k]

            // 隐藏私有属性
            if (!k.startsWith('_')) {
                if (typeof v === 'function') {
                    compileContext[k] = v.bind(c)
                } else {
                    // readonly
                    Object.defineProperty(compileContext, k, {
                        get() {
                            return c[k]
                        },
                    })
                }
            }
        })

        this._compileContext = compileContext
    }
    // 编译前清理动作
    _clean() {
        let _expired = []
        // 文件在磁盘上可能发生了变动，需要维护状态一致性
        return this._inited
            .then(() => this.cleanExpired())
            .then((expired) => {
                _expired = expired
                return invokeHook(this, 'clean', { expired })
            })
            .then(() => {
                // 清理依赖图
                this.removeGraphNodes(_expired)
                if (_expired.length) {
                    this.reverseDep()
                }
                // 清理缓存
                this.removeCache(_expired)
            })
    }
    // 执行task
    _runTasks(userTasks = {}, internalTasks = {}) {
        return (
            // init hooks
            this._inited
                // 进度统计
                .then(() => {
                    let paths = [],
                        num = 0

                    Object.values(userTasks)
                        .concat(Object.values(internalTasks))
                        .forEach((v) => {
                            if (v.test) {
                                // 配置型任务
                                paths.push(v.test)
                            } else {
                                // func任务
                                num++
                            }
                        })

                    // lock
                    this.compiling = true

                    progress.append(statsFilesNum(paths) + num)
                })
                // before hooks
                .then(() => invokeHook(this, 'beforeCompile'))
                // compiling
                .then(() => {
                    let internalGulpTasks = Object.values(internalTasks).map(
                            (v) => this.createGulpTask(v)
                        ),
                        userGulpTasks = Object.values(userTasks).map((v) =>
                            this.createGulpTask(v)
                        ),
                        topTasks = []

                    // 内置任务优先
                    if (internalGulpTasks.length) {
                        topTasks.push(parallel(...internalGulpTasks))
                    }
                    // 用户级任务
                    if (userGulpTasks.length) {
                        topTasks.push(parallel(...userGulpTasks))
                    }
                    // 收尾工作
                    if (topTasks.length) {
                        topTasks.push((cb) => {
                            // 更新依赖图
                            this.reverseDep()
                            // save env
                            this.save('env', this.options.env)
                            cb()
                        })
                    }

                    return new Promise((resolve, reject) => {
                        topTasks.length
                            ? series(...topTasks)((err) =>
                                  err ? reject(err) : resolve()
                              )
                            : resolve()
                    })
                })
                // after hooks
                .then(() => invokeHook(this, 'afterCompile'))
                .finally(() => {
                    // unlock
                    this.compiling = false
                })
        )
    }
    // 查询数据库
    query(key, defaults) {
        return this._db.get(key).value() || defaults
    }
    // 写数据库
    save(key, value) {
        if (key) {
            this._db.set(key, value).write()
        }
    }
    // 创建watcher
    createWatcher(paths, options) {
        if (typeof paths === 'string') {
            paths = [paths]
        }

        log(ansiColors.white(`watching ${paths}`))
        let watcher = watch(
            paths,
            Object.assign({ ignored: /[\/\\]\./ }, options)
        )

        // catch chokidar error
        watcher.on('error', logError)
        // catch gulp error
        let errorListeners = gulp.listeners('error')
        if (errorListeners && errorListeners.indexOf(logError) < 0) {
            gulp.on('error', logError)
        }

        return watcher
    }
    // 编译
    run() {
        if (this.running) {
            return
        }
        this.running = true
        this._userTasks = this._normalizeTasks(this.options.tasks || {})
        this._internalTasks = this._normalizeTasks(internalTasks)

        return this._inited
            .then(() => this._setCompileContext())
            .then(() => this._clean())
            .then(() => this._runTasks(this._userTasks, this._internalTasks))
            .finally(() => (this.running = false))
    }
    // 编译并watch
    watch() {
        if (this.running) {
            return
        }
        this.running = true
        this._userTasks = this._normalizeTasks(this.options.tasks || {})
        this._internalTasks = this._normalizeTasks(internalTasks)

        return this._inited
            .then(() => this._setCompileContext())
            .then(() => this._clean())
            .then(() => this._runTasks(this._userTasks, this._internalTasks))
            .then(() => {
                // watching
                this._watchers.push(sourceWatcher(this))
                this._watchers.push(pkgWatcher(this))
            })
            .finally(() => (this.running = false))
    }
    // 停止watch
    stop() {
        this._watchers.forEach((v) => v.close())
        this._watchers = []
    }
    // 创建gulpTask
    createGulpTask(config) {
        const taskCtx = this.createTaskContext()

        // functional-task
        if (typeof config === 'function') {
            return series(
                function (cb) {
                    return config.call(taskCtx, cb)
                },
                function (cb) {
                    progress.increment()
                    cb()
                }
            )
        }

        // stream-task
        const { test, use, cache, output } = config
        const { cacheDir, outputDir, sourceDir } = this.options
        const paths = test,
            transformer = combine(
                ...use.map(([name, options]) => rqp(name)(options))
            )

        return function () {
            return (
                src(paths, {
                    base: sourceDir,
                })
                    // 上下文注入
                    .pipe(gulpFileContext(taskCtx))
                    // 编译缓存
                    .pipe(
                        gulpIf(
                            cache,
                            gulpCompileCache({
                                cacheDir, // 缓存文件存放位置
                                outputDir, // 输出目录
                                hit: () => progress.increment(), // 若缓存命中，pipe会中止，所以进度+1
                            })
                        )
                    )
                    .pipe(transformer)
                    // 输出
                    .pipe(gulpIf(output, dest(outputDir)))
                    // 进度+1
                    .pipe(gulpProgress())
            )
        }
    }
    // 获取任务配置对象
    getTaskConfig(taskType, overrides) {
        var result = this._internalTasks[taskType] || this._userTasks[taskType]
        // clone
        if (result) {
            result = Object.assign({}, result, overrides)
        }

        return result
    }
    // 获取任务类型
    getTaskType(filePath) {
        var t = path.extname(filePath).replace('.', '')

        if (this.options.imgType.indexOf(t) >= 0) {
            t = 'img'
        }

        return t
    }
    // 增量编译
    incrementCompile(filePaths = []) {
        if (!Array.isArray(filePaths)) {
            filePaths = [filePaths]
        }

        let { sourceDir } = this.options
        filePaths.forEach((p) => {
            let taskType = this.getTaskType(p),
                taskConfig = this.getTaskConfig(taskType)

            // 需更新上游
            if (taskConfig && taskConfig.compileAncestor) {
                filePaths.push(
                    ...this.traceReverseDep(p).map((v) =>
                        path.join(sourceDir + v)
                    )
                )
            }
        })
        // 无需编译
        if (filePaths.length <= 0) return
        // 编译任务集合
        let tasks = groupBy(filePaths, (v) => this.getTaskType(v))
        tasks = Object.entries(tasks).reduce((acc, [t, paths]) => {
            let config = this.getTaskConfig(t, {
                test: paths,
                cache: false, // 忽略缓存
            })

            // 跳过不支持的任务
            if (!config) {
                // prettier-ignore
                log(ansiColors.yellow(`Compiling .${t} files is not supported!`))
            } else {
                acc[t] = config
            }

            return acc
        }, {})
        // no tasks
        if (Object.keys(tasks).length <= 0) {
            return
        }
        // run tasks
        this.nextTask(() => this._runTasks(tasks))
    }
    // 添加代办任务
    nextTask(fn) {
        queueTask(fn)
    }
    // 模块路径解析
    wgsResolve(request, relativePath) {
        var d,
            pwd = relativePath ? path.dirname(relativePath) : this.sourceDir

        if (path.isAbsolute(request)) {
            // from root
            d = path.join(this.sourceDir, request)
        } else if (request.startsWith('./') || request.startsWith('../')) {
            // releative
            d = path.resolve(pwd, request)
        } else {
            // for node_modules
            d = path.resolve(this.sourceDir, request)
        }

        return d
    }
    // 创建文件上下文
    createFileContext(file) {
        let fileContext = Object.create(this._compileContext)

        Object.assign(fileContext, {
            originalPath: file.path,
            customDeps: [], // 自定义依赖
            depended: false,
        })

        return fileContext
    }
    // 创建task上下文
    createTaskContext() {
        let taskContext = Object.create(this._compileContext)

        return taskContext
    }
    // 插件安装
    static use(plugin) {
        if (plugins.indexOf(plugin) >= 0) return

        plugins.push(plugin)
        plugin(Compiler)
    }
    // 添加hook
    static installHook(name, cb) {
        // hook map
        if (type(name) === 'object') {
            Object.entries(name).forEach(([k, v]) => Compiler.installHook(k, v))
        } else {
            hooks[name] && hooks[name].push(cb)
        }
    }
    // 设置pipe
    static setPipe(k, v) {
        rqp.cache[k] = v
    }
    // 移除pipe
    static removePipe(k) {
        delete rqp.cache[k]
    }
    // 获取pipe
    static getPipe(k) {
        return rqp(k)
    }
}

module.exports = Compiler
