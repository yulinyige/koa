'use strict';

/**
 * Module dependencies.
 */

const isGeneratorFunction = require('is-generator-function');
const debug = require('debug')('koa:application');
const onFinished = require('on-finished');
const response = require('./response');
const compose = require('koa-compose');
const context = require('./context');
const request = require('./request');
const statuses = require('statuses');
const Emitter = require('events');
const util = require('util');
const Stream = require('stream');
const http = require('http');
const only = require('only');
const convert = require('koa-convert');
const deprecate = require('depd')('koa');
const { HttpError } = require('http-errors');

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 * 使用时直接使用此类.
 * 为什么要继承 Emitter ? 可以使用 on, emit 方法进行时间监听, 如抛出异常.
 */

module.exports = class Application extends Emitter {
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  /**
   * 构造方法, 可以传入一个对象作为参数
   * 主要初始化一些东西 ....
   *
   * @param {object} [options] Application options
   * @param {string} [options.env='development'] Environment
   * @param {string[]} [options.keys] Signed cookie keys
   * @param {boolean} [options.proxy] Trust proxy headers
   * @param {number} [options.subdomainOffset] Subdomain offset
   * @param {boolean} [options.proxyIpHeader] proxy ip header, default to X-Forwarded-For
   * @param {boolean} [options.maxIpsCount] max ips read from proxy ip header, default to 0 (means infinity)
   *
   */

  constructor(options) {
    super(); // 继承了Emitter, 需调用super
    options = options || {}; // 默认为空 ...
    this.proxy = options.proxy || false; // 是否信任 proxy header 参数，默认为false
    this.subdomainOffset = options.subdomainOffset || 2; // ?
    this.proxyIpHeader = options.proxyIpHeader || 'X-Forwarded-For'; // IP header 参数
    this.maxIpsCount = options.maxIpsCount || 0; // 最大 IP 数量
    this.env = options.env || process.env.NODE_ENV || 'development'; // 环境参数，默认为 NODE_ENV 或 'development'
    if (options.keys) this.keys = options.keys; // ?
    this.middleware = []; // 保存通过 app.use(middleware) 注册的中间件
    this.context = Object.create(context); // context 模块，通过 context.js 创建
    this.request = Object.create(request); // request 模块，通过 request.js 创建
    this.response = Object.create(response); // response 模块，通过 response.js 创建
    if (util.inspect.custom) {
      this[util.inspect.custom] = this.inspect;
    }
  }

  /**
   * Shorthand for:
   *
   *    http.createServer(app.callback()).listen(...)
   *
   *  这只是一个简写
   *
   * @param {Mixed} ...
   * @return {Server}
   * @api public
   */
  listen(...args) {
    debug('listen'); // debug 日志
    const server = http.createServer(this.callback()); // 使用到了 Node.js 的 http 模块. this.callback 就是得到请求后调用的函数
    return server.listen(...args); // 监听 .... 居然用了 ES6 的方法 ... 和 Express 不一样
  }

  /**
   * Return JSON representation.
   * We only bother showing settings.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    return only(this, [
      'subdomainOffset',
      'proxy',
      'env'
    ]);
  }

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect() {
    return this.toJSON();
  }

  /**
   * Use the given middleware `fn`.
   * 其实就是传递过来一个函数, 先存起来, 调用的时候就可以从中间件拿了.
   *
   * Old-style middleware will be converted.
   *
   * @param {Function} fn
   * @return {Application} self
   * @api public
   */
  use(fn) {
    if (typeof fn !== 'function') throw new TypeError('middleware must be a function!'); // 判断传递进来的是不是函数, 如果不是, 则直接报错.
    // 如果是 Generator 函数, 则进行转换, 并跳出提示.
    if (isGeneratorFunction(fn)) {
      // Koa1.x 版本使用 Generator Function 的方式写中间件，而 Koa2 改用 ES6 async/await。所以在 use() 函数中会判断是否为旧风格的中间件写法，并对旧风格写法得中间件进行转换( 使用 koa-convert 进行转换 )
      deprecate('Support for generators will be removed in v3. ' +
        'See the documentation for examples of how to convert old middleware ' +
        'https://github.com/koajs/koa/blob/master/docs/migration.md');
      fn = convert(fn);
    }
    debug('use %s', fn._name || fn.name || '-');
    this.middleware.push(fn); // 小心地存起来
    return this; // 可以注意到这里 use() 函数返回了 this，这使得在添加中间件的时候能链式调用
  }

  /**
   * Return a request handler callback
   * for node's native http server. 返回一个 Node 原生 Http server.
   * 这是所有请求处理的入口.
   *
   * 通过 compose 函数 (koa-compose) 合并 app.middleware 中的所有中间件。查看关于 koa-compose 的分析
   * app.callback() 函数返回一个请求处理函数 handleRequest。该函数即为 http.createServer 接收的请求处理函数，在得到请求时执行。
   *
   * @return {Function} 返回的是一个 handleRequest 函数. 这个函数可以创建请求的上下文.
   * @api public
   */
  callback() {
    const fn = compose(this.middleware); // 合并中间件. 传过去一个数组, 返回一个数组

    if (!this.listenerCount('error')) this.on('error', this.onerror); // 这就用到了 Emitter 的功能. 如果没有对 error 事件进行监听, 那么绑定 默认的 onerror 事件监听处理

    const handleRequest = (req, res) => {
      const ctx = this.createContext(req, res); // 创建请求上下文 ... 其实就是创建一个对象... 里面以后一堆函数和一堆变量
      return this.handleRequest(ctx, fn); // 注意这里的 this.handleRequest 是调用类的函数, 并不是调用上面这个方法. 执行中间件 fn
    };

    return handleRequest;
  }

  /**
   * Handle request in callback.
   *
   * @api private
   * @param ctx 请求上下文
   * @param fnMiddleware 中间件, 是一个 promise.
   */
  handleRequest(ctx, fnMiddleware) {
    const res = ctx.res;
    res.statusCode = 404; // 默认的状态码是 404, 为什么要预设呢 ? 这和我的做法有什么区别.
    const onerror = err => ctx.onerror(err); // 这里为什么要再创建一个匿名方法 ? 为什么不直接吧 onerror 传递到 onFinished ???
    const handleResponse = () => respond(ctx);
    onFinished(res, onerror);
    return fnMiddleware(ctx).then(handleResponse).catch(onerror); // 非常重要 !!!
  }

  /**
   * Initialize a new context.
   * 原来 context 就是这么来的
   *
   * @api private
   */
  createContext(req, res) {
    const context = Object.create(this.context); // 使用 context 再创建一个. 用 Object.create() 语法创建一个新对象，使用现有的对象来提供新创建的对象的 __proto__
    const request = context.request = Object.create(this.request); // 使用 request 再创建一个
    const response = context.response = Object.create(this.response);
    context.app = request.app = response.app = this; // 挂载变量
    context.req = request.req = response.req = req;
    context.res = request.res = response.res = res;
    request.ctx = response.ctx = context;
    request.response = response;
    response.request = request;
    context.originalUrl = request.originalUrl = req.url;
    context.state = {}; // 默认的 state 为空, 其实就是一个对象
    return context;
  }

  /**
   * Default error handler.
   *
   * @param {Error} err
   * @api private
   */
  onerror(err) {
    if (!(err instanceof Error)) throw new TypeError(util.format('non-error thrown: %j', err));

    if (404 == err.status || err.expose) return;
    if (this.silent) return;

    const msg = err.stack || err.toString();
    console.error();
    console.error(msg.replace(/^/gm, '  '));
    console.error();
  }
};

/**
 * Response helper.
 */

function respond(ctx) {
  // allow bypassing koa, 所以如果不想返回, 只要设置了 respond  = false 即可.
  if (false === ctx.respond) return;

  if (!ctx.writable) return; // 上下文对象不可写时, 也会退出.

  const res = ctx.res;
  let body = ctx.body;
  const code = ctx.status;

  // ignore body. status 哪来的 ?
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  if ('HEAD' === ctx.method) {
    if (!res.headersSent && !ctx.response.has('Content-Length')) {
      const { length } = ctx.response;
      if (Number.isInteger(length)) ctx.length = length;
    }
    return res.end();
  }

  // status body
  if (null == body) {
    if (ctx.req.httpVersionMajor >= 2) {
      body = String(code);
    } else {
      body = ctx.message || String(code);
    }
    if (!res.headersSent) {
      ctx.type = 'text';
      ctx.length = Buffer.byteLength(body);
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if ('string' == typeof body) return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body);
}

/**
 * Make HttpError available to consumers of the library so that consumers don't
 * have a direct dependency upon `http-errors`
 */
module.exports.HttpError = HttpError;
