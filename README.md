# lumi-rescript-dev

This is a utility to build and bundle rescript projects using esbuild.

- Very fast builds
- Watcher with live-reload
- Service workers
- Sass support

## How to use

```sh
npm install @lumiguide/lumi-rescript-dev --save-dev
# or
yarn add @lumiguide/lumi-rescript-dev --dev
```

* Run `lumi-rescript-dev watch` in your project root to start the development server
* Run `lumi-rescript-dev build` in your project root for a production build

Typically, you'll want to add the following to your `package.json`.

```json
{
  "scripts": {
    "prepare": "lumi-rescript-dev build",
    "start": "lumi-rescript-dev watch",
    "start-prod": "lumi-rescript-dev watch '{\"http\":{\"proxy\":{\"target\":\"https://your-prod.com/\"}}}'",
    "clean": "rescript clean && rm -rf public/bundle"
  },
}
```

## Project structure

The default config expects something like the following project structure:
```
project-name
├── bsconfig.json
├── package.json
├── public
│  ├── images
│  │  ├── favicon.ico
│  │  ├── icons-512.png
│  │  └── some-image.png
│  ├── index.html
│  └── site.webmanifest
└── src
   ├── css
   │  ├── default.scss
   │  └── main.sass
   ├── Index.res
   └── Util.res

```

Generated files will end up in `lib` and `public/bundle`, by default.

## Configuration
The default configuration can be inspected using `lumi-rescript-dev dump-config`, and changes can be made by adding them to the `lumi-rescript-dev` key in your `package.json`.

## JS API
Alternatively, if you require more configuration flexibility, the code can be imported from your own code.
```js
const {main, defaultConfig} = require('@lumiguide/lumi-rescript-dev')

main(defaultConfig, {
  root: __dirname
  // ...
})
```
