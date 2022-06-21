const watchman = require('fb-watchman')

class Watchman {
    constructor() {
        this.client = new watchman.Client()
    }
    command(...args) {
        return new Promise((resolve, reject) => {
            this.client.command(args, (err, resp) => {
                if (err) reject(err)
                else resolve(resp)
            })
        })
    }
    async setup_watches(dirname) {
        const { warning, watch, relative_path } = await this.command("watch-project", dirname)
        if (warning) {
            console.warn('[watchman]', warning);
        }
        console.log('[watchman] watch established on:', watch, 'relative_path:', relative_path);
        Object.assign(this, { watch, relative_path })
        this.clock = await this.command("clock", watch)
    }
    async subscribe(name, expression) {
        const sub = {
            expression,
            fields: ["name", "size", "mtime_ms", "exists", "type"],
            since: this.clock
        }
        if (this.relative_path) sub.relative_root = this.relative_path
        await this.command('subscribe', this.watch, name, sub)
    }
    on(x, y) {
        return this.client.on(x, y)
    }
}
module.exports.Watchman = Watchman
