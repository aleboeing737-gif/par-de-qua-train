const BACKEND='https://par-de-qua-train-api.onrender.com';

async function proxy(request, env) {
  const u=new URL(request.url);
  if(u.pathname.startsWith('/api/')) {
    const target=new URL(BACKEND+u.pathname+u.search);
    return fetch(new Request(target,{method:request.method,headers:request.headers,body:request.method==='GET'||request.method==='HEAD'?undefined:request.body}));
  }
  return env.ASSETS.fetch(request);
}
export default {fetch:proxy};
