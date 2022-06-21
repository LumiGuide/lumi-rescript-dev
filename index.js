#!/usr/bin/env node
const path = require('path')
const util = require('util')
const lockfile = require('lockfile')
const child_process = require('child_process')
const esbuild = require('esbuild')
const { sassPlugin } = require('esbuild-sass-plugin')
const morgan = require('morgan')
const express = require('express')
const { Watchman } = require('./Watchman.js')
const { createProxyMiddleware } = require('http-proxy-middleware')
const mergeOptions = require('merge-options')
const findWorkspaceRoot = require('find-yarn-workspace-root')
const { generateSW } = require('workbox-build')
const fs = require('fs')

module.exports.mergeOptions = mergeOptions

const sassCache = new Map()
const sass = sassPlugin({
    cache: sassCache,
})

module.exports.generateConfig = root => ({
    workspaceRoot: findWorkspaceRoot(root) || root,
    root: root,
    http: {
        port: 8020,
        proxy: {
            prefixes: ['/api/'],
            target: 'http://localhost:8000',
        },
        static: {
            dir: 'public',
            mountPoint: `/${path.basename(root)}/`
        },
    },
    esbuild: {
        entryPoints: {
            bundle: path.join(root, 'lib/es6/src/Index.bs.js')
        },
        bundle: true,
        minify: true,
        sourcemap: true,
        target: ['firefox85', 'chrome89'],
        loader: {
            '.woff': 'file',
            '.woff2': 'file',
            '.eot': 'file',
            '.ttf': 'file',
            '.svg': 'file',
            '.png': 'file'
        },
        outdir: path.join(root, 'public/bundle'),
        logLevel: 'info',
        plugins: [sass],
    },
    workbox: {
        injectInstallSW: {
            enable: false, // only in prod build
            path: path.join(root, "src/install-service-worker.js"),
        },
        generateSW: {
            enable: false, // only in prod build
            globDirectory: 'public/',
            globPatterns: [
                '**/*.{css,js,woff,eot,woff2,svg,ttf,png,ico,html}'
            ],
            globIgnores: [
                "*.map",
            ],
            swDest: 'public/sw.js', // Can not be in bundle/ subdirectory without custom security header
            // These options encourage the ServiceWorkers to get in there fast
            // and not allow any straggling "old" SWs to hang around
            clientsClaim: true,
            skipWaiting: true,
            cleanupOutdatedCaches: true,
        }
    },
})
module.exports.defaultConfig = module.exports.generateConfig(require.main.path);

class Lock {
    constructor() {
        this.queue = []
        this.lock = false
    }
    async run(fn) {
        if (this.lock) {
            await new Promise((resolve, _reject) => {
                this.queue.push(resolve)
            })
        }
        this.lock = true
        try {
            const res = await fn()
            return res
        } finally {
            this.lock = false
            if (this.queue.length) this.queue.shift()()
        }
    }
}

class Notifier {
    constructor() {
        this.clients = []
        this.d = null
    }
    notifyClient(res) {
        const d = JSON.stringify({ LAST_SUCCESS_BUILD_STAMP: this.d })
        res.write(`data: ${d}\n\n`)
    }
    notifyAll() {
        this.d = Date.now()
        this.clients.forEach((res) => this.notifyClient(res))
        this.clients = []
    }
    addClient(client) {
        client.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        })
        this.clients.push(client)
        if (this.d) {
            this.notifyClient(client)
        }
    }
}

function serve(config) {
    // Set up web server with logging
    const app = express()
    app.use(morgan('dev'))

    if (config.http.static) {
        // Serve static files
        app.use(config.http.static.mountPoint, express.static(config.http.static.dir))
    }

    // Endpoint for live reloading
    const notifier = new Notifier()
    app.get('/esbuild', (_req, res) => {
        console.log('[notifier] new live reload client')
        return notifier.addClient(res)
    })

    // Proxy to live Stallingsnet
    if (config.http.proxy.target) {
        app.use(config.http.proxy.prefixes, createProxyMiddleware({
            target: config.http.proxy.target,
            changeOrigin: true,
            onProxyRes: (proxyRes, _req, _res) => {
                // Remove 'Secure' and 'SameSite=' from cookies, otherwise they are ignored
                const sc = proxyRes.headers['set-cookie']
                if (Array.isArray(sc)) {
                    proxyRes.headers['set-cookie'] = sc.map(sc => {
                        return sc.split(';')
                            .filter(v => {
                                const vl = v.trim().toLowerCase()
                                return vl !== 'secure' && !vl.startsWith('samesite')
                            })
                            .concat('SameSite=Strict')
                            .join('; ')
                    })
                }
            },
        }))
    }

    app.listen(config.http.port, () => {
        console.log(`[http] listening on http://localhost:${config.http.port}${config.http.static?.mountPoint || ''}`)
    })

    return { notifier }
}

async function bracket(name, fn) {
    console.log(`[${name}] starting`)
    try {
        const res = await fn()
        console.log(`[${name}] succeeded`)
        return res
    } catch (e) {
        console.error(`[${name}] error:`, e.message)
        throw e
    }
}

async function passthrough(command, args = [], options = {}) {
    const defaults = {
        cmd: undefined,
        env: process.env,
        stdio: 'inherit',
    }
    const child = child_process.spawn(command, args, Object.assign(defaults, options))
    return new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('close', _code => {
            resolve(child)
        })
    })
}

async function compile(config) {
    const rescriptPath = path.join(config.root, 'node_modules', '.bin', 'rescript')

    return bracket("rescript", async () => {
        const result = await passthrough(rescriptPath, ['build', '-with-deps'])
        if (result.exitCode !== 0) {
            throw new Error('Compilation failed')
        }
    })
}

async function bundle(config, opts = {}) {
    return bracket("esbuild", async () => {
        return esbuild.build(Object.assign({}, config.esbuild, opts))
    })
}

async function generateServiceWorker(config) {
    if (!config.workbox.generateSW.enable) {
        return
    }
    return bracket("workbox", async () => {
        // generateSW dislikes the 'enable' attr
        const generateSWCfg = Object.assign({}, config.workbox.generateSW)
        delete generateSWCfg.enable
        return generateSW(generateSWCfg)
    })
}

async function devServer(config) {
    try {
        lockfile.lockSync(path.join(config.root, '.bsb.lock'))
        // Is cleaned up when the process exits
    } catch (err) {
        console.error("[lock] error creating .bsb.lock:", err)
    }

    const { notifier } = serve(config)

    const wm = new Watchman()
    await wm.setup_watches(config.workspaceRoot)
    await wm.subscribe("rebuild", [
        "allof",
        [
            "anyof",
            ["match", "*.res"],
            ["match", "*.js"],
            ["match", "*.mjs"],
            ["match", "*.json"],
            ["match", "*.css"],
            ["match", "*.scss"],
            ["match", "*.sass"],
        ].concat(Object.keys(config.esbuild.loader).map(x => ["match", "*" + x])),
        ["not", ["dirname", path.relative(config.workspaceRoot, config.esbuild.outdir)]], // esbuild output
        ["not", ["match", "*/lib/**", "wholename"]], // ReScript output dir
        ["not", ["match", "sw.js"]], // Service Worker
        ["not", ["match", "workbox-*.js"]], // Service Worker
    ])

    var bundleResult
    const compileBundleNotify = async () => {
        await compile(config)

        if (bundleResult === undefined) {
            bundleResult = await bundle(config, {
                incremental: true,
                minify: false,
                inject: [path.join(__dirname, "live-reload.js")],
            })
        } else {
            const result = await bracket("esbuild incremental", async () => {
                return bundleResult.rebuild()
            })
            if (result.errors.length !== 0) {
                throw new Error('Incremental bundle failed')
            }
        }

        // Service Worker is not generated during watch mode

        notifier.notifyAll()
    }

    // Initial compilation + bundle
    try {
        await compileBundleNotify()
    } catch (err) {
        // Ignore (already reported to user)
    }

    const buildConfigFiles = [
        path.relative(config.workspaceRoot, __filename), // lumi-rescript-dev/index.js
        path.relative(config.workspaceRoot, path.join(config.root, 'build.js')), // project/build.js
    ]
    const lock = new Lock()
    wm.on('subscription', resp => {
        const changed = resp.files.map(({ name }) => name)
        if (changed.some(name => buildConfigFiles.includes(name))) {
            // TODO: self-restart
            console.error("[watcher] TODO: self-restart; build config changed: ", changed)
            process.exit(1)
        }
        console.log("[watcher] files changed:", changed)
        lock.run(async () => {
            try {
                await compileBundleNotify()
            } catch (err) {
                // Ignore (already reported to user)
                console.warn(err)
            }
        })
    })
}

async function main(...configs) {
    const config = mergeOptions(...configs)
    switch (process.argv[2]) {
        case "watch":
            try {
                await devServer(config)
            } catch (err) {
                console.error(err)
                process.exit(1)
            }
            break
        case "build":
            if (config.workbox.injectInstallSW.enable) {
                config.esbuild.inject = Array.prototype.concat(config.esbuild.inject || [], [config.workbox.injectInstallSW.path])
            }
            try {
                await compile(config)
                await bundle(config)
                await generateServiceWorker(config)
            } catch (err) {
                console.error(err)
                process.exit(1)
            }
            break
        case "bundle":
            try {
                await bundle(config)
            } catch (err) {
                console.error(err)
                process.exit(1)
            }
            break
        case "dump-config":
            if (process.stdout.isTTY) {
                console.log(util.inspect(config, {
                    depth: null,
                    colors: true
                }))
            } else {
                process.stdout.write(JSON.stringify(config))
            }
            break
        default:
        console.error("Usage:", process.argv[1], "<watch|build|bundle> [{json}]")
            process.exit(1)
    }
}
module.exports.main = main
if (require.main == module) {
    const package_json = require(path.join(process.cwd(), "package.json"))
    if (!package_json || package_json.name == "lumi-rescript-dev") {
        console.error("For standalone usage, you have to run this in a package dir")
        process.exit(1)
    } else {
        const override = JSON.parse(process.argv[3] || '{}')
        main(module.exports.generateConfig(process.cwd()), package_json["lumi-rescript-dev"] || {}, override)
    }
}
