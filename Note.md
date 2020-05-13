# 笔记
事实上, Koa 就是规范一个处理流程, 最主要的是
- 定义了洋葱模型 ( 这是重中之重 )
- 使用 async / await 方法 ( 实现洋葱模型的基础 )
- 定义 context 上下文 ( 封装一些变量 / 工具 / 以及 req / res )
- 封装 request / response.

### 如何理解 JS 动态语言的作用域
即作用域在运行时才绑定 ? 比如用 bind 或者 call 可以改变作用域. 所以 JS 特别不好理解就是这样了.

### Reference
[Koa2源码分析](https://www.jianshu.com/p/183044c0cd77)

### 核心 koa-compose 的理解
```js
/**
 * Compose `middleware` returning
 * a fully valid middleware comprised
 * of all those which are passed.
 *
 * @param {Array} middleware middleware 是一个数组 ....
 * @return {Function}
 * @api public
 */

function compose (middleware) {
  if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
  for (const fn of middleware) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
  }

  /**
   * @param {Object} context
   * @return {Promise}
   * @api public
   */

  return function (context, next) {
    // last called middleware #
    let index = -1
    return dispatch(0)
    function dispatch (i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      let fn = middleware[i]
      if (i === middleware.length) fn = next
      if (!fn) return Promise.resolve()
      try {
        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
      } catch (err) {
        return Promise.reject(err)
      }
    }
  }
}
```
```
function compose (middleware) {
  if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
  for (const fn of middleware) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
  }

  /**
   * @param {Object} context
   * @return {Promise}
   * @api public
   */

  return function (context, next) {
    // last called middleware #
    let index = -1
    return dispatch(0)
    function dispatch (i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      let fn = middleware[i] //fn只是一个函数声明,在下面调用
      if (i === middleware.length) fn = next 
      // 这里的next其实没有用 只是用来处理i ===middleware.length的情况 
      // next永远是空 这个next和下面的next是不一样的
      if (!fn) return Promise.resolve()
      try {
        // 因为fn（）是一个async函数 返回一个promise对象 Promise.resolve（）遇到promise对象的时候会原封不动的返回该对象
        // context就是封装好的ctx对象, next是你写在use里面的next
        // 执行fn()代码 就是执行自定的async函数 遇到内部await next()则会等待回调函数结束
        // 而这个回调函数递归调用下一个middleware 碰到下一个middleware的await next()则会继续调用下一个
        // 直到调用到最后一个 返回一个空的promise.resolve（）对象 则先是最后一个middleware收到这个promise对象
        // 就执行await()下面的函数 最后一个中间件执行完毕后
        // 则会再到之前的中间件去执行
        return Promise.resolve(fn(context, function next () {

          /* 这个fn()就是
          next就是它的回调函数
          async (ctx,next) => {
             console.log("1-start");
             await next();
             console.log("1-end");
          } 
          注意这上面的函数是我们常写的函数 ctx就是context, next就是function next(){...}
          * fn(context, function next () {  //
              return dispatch(i + 1)
            })
          */
          return dispatch(i + 1)
        }))
      } catch (err) {
        return Promise.reject(err)
      }
    }
  }
}
```
