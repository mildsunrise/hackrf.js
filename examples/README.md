These are some simple SDR examples written in JS using hackrf.js. Keep in mind these aren't written with performance in mind and are pretty basic, refer to each example's top comment for more info.

To run the examples, first do `npm install` which should automatically compile the library into `dist`. Once this is done, use [ts-node](https://www.npmjs.com/package/ts-node), i.e.:

~~~ bash
"$(npm bin)"/ts-node examples/fm_tone.ts
~~~
