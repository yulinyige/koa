const Koa = require('../lib/application');
const app = new Koa();

/**
 * 参数 ctx 封装了 req, res
 */
app.use(async (ctx, next) => {
  console.log('Hello world !!!');
  ctx.body = 'Hello world'; // 看似是一个赋值操作, 事实上用到了 js 中的 set 属性. 相当于调用了 ctx 的 set.body 方法.
});

app.listen(3000);
