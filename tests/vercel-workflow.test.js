import test from 'node:test';
import assert from 'node:assert/strict';

test('Vercel yayın girişi eksik kurulum onarılırken eski akışı korur',async()=>{
 const before=process.env.ORDER_WORKFLOW_ENABLED;
 try{
  for(const [value,expected] of [[undefined,false],['0',false],['1',false]]){
   if(value===undefined)delete process.env.ORDER_WORKFLOW_ENABLED;else process.env.ORDER_WORKFLOW_ENABLED=value;
   const {default:handler}=await import(`../api/index.js?workflow=${value}`);
   let status,body;
   const response={setHeader(){},writeHead(code){status=code;},end(value){body=JSON.parse(value);}};
   await handler({url:'/api/config',method:'GET',headers:{host:'localhost'}},response);
   assert.equal(status,200);assert.equal(body.workflowEnabled,expected);
  }
 }finally{if(before===undefined)delete process.env.ORDER_WORKFLOW_ENABLED;else process.env.ORDER_WORKFLOW_ENABLED=before;}
});
