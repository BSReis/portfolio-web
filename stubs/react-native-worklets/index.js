'use strict';
function id(v){return v;}
function createSerializable(v){return v;}
function makeShareableCloneRecursive(v){return v;}
function makeShareableCloneOnUIRecursive(v){return v;}
function runOnUI(fn){return function(){return fn.apply(this,arguments);};}
function runOnJS(fn){return fn;}
function executeOnUIRuntimeSync(fn){return fn;}
function runOnUIImmediately(fn){return function(){return fn.apply(this,arguments);};}
function makeWorklet(fn){return fn;}
function isWorklet(){return false;}
function WorkletEventHandler(){}
WorkletEventHandler.prototype.register=function(){};
WorkletEventHandler.prototype.unregister=function(){};
function registerEventHandler(){return function(){};}
function unregisterEventHandler(){}
function getViewProp(){return Promise.resolve(null);}
function measure(){return null;}
function serialize(v){return v;}
function deserialize(v){return v;}
function createWorkletContext(){return {};}
function releaseWorkletContext(){}
const WorkletsModule={makeShareableCloneRecursive,makeShareableCloneOnUIRecursive,runOnUI,runOnJS,isWorklet,WorkletEventHandler};
module.exports={createSerializable,makeShareableCloneRecursive,makeShareableCloneOnUIRecursive,runOnUI,runOnJS,runOnUIImmediately,executeOnUIRuntimeSync,makeWorklet,isWorklet,WorkletEventHandler,registerEventHandler,unregisterEventHandler,getViewProp,measure,serialize,deserialize,createWorkletContext,releaseWorkletContext,WorkletsModule,default:WorkletsModule};
