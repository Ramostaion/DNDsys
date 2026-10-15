import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {findLocalDatabase,findLauncherDatabase} from './launcher-config.mjs';

const db={host:'127.0.0.1',port:51214};
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'dnd-launcher-config-'));
  t.after(()=>{
    const target=resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir())+sep));
    rmSync(target,{recursive:true,force:true});
  });
  const state=join(directory,'prisma-dev-nodejs','Data');
  mkdirSync(state,{recursive:true});
  const register=(name,contents)=>{
    const folder=join(state,name);mkdirSync(folder,{recursive:true});
    writeFileSync(join(folder,'server.json'),contents);
  };
  return {directory,state,register};
}
const server={name:'projectdnd',port:51213,databasePort:51214,shadowDatabasePort:51215};

test('finds the original registration and exposes only startup metadata',t=>{
  const {directory,register}=fixture(t);
  register('projectdnd',JSON.stringify({...server,password:'must-not-appear'}));
  const result=findLocalDatabase(db,directory);
  assert.deepEqual(result.localServer,server);
  assert.equal(result.localDatabaseIssue,null);
  assert.equal(result.localDatabaseAppData,directory);
  assert.ok(!JSON.stringify(result).includes('must-not-appear'));
});

test('uses the same Windows home fallback as Prisma when LOCALAPPDATA is absent',()=>{
  const original=process.env.LOCALAPPDATA;
  try{
    delete process.env.LOCALAPPDATA;
    assert.equal(findLocalDatabase(db).databaseStateDir,join(homedir(),'AppData','Local','prisma-dev-nodejs','Data'));
  }finally{
    if(original===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=original;
  }
});

test('recovers an existing home registration when LOCALAPPDATA points to a missing directory',t=>{
  const {directory,register}=fixture(t);
  register('projectdnd',JSON.stringify(server));
  const original=process.env.LOCALAPPDATA;
  try{
    process.env.LOCALAPPDATA=join(directory,'missing');
    // Keep the fallback inside this test's fixture instead of the real user database.
    const result=findLocalDatabase(db,undefined,directory);
    assert.deepEqual(result.localServer,server);
    assert.equal(result.localDatabaseAppData,directory);
  }finally{
    if(original===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=original;
  }
});

test('accepts an existing registration with a UTF-8 BOM',t=>{
  const {directory,register}=fixture(t);
  register('projectdnd','\uFEFF'+JSON.stringify(server));
  assert.deepEqual(findLocalDatabase(db,directory).localServer,server);
});

test('reports a port mismatch without starting another database',t=>{
  const {directory,register}=fixture(t);
  register('projectdnd',JSON.stringify({...server,databasePort:5432}));
  const result=findLocalDatabase(db,directory);
  assert.equal(result.localServer,null);
  assert.match(result.localDatabaseIssue,/5432.*51214/);
});

test('reports damaged registration and skips unrelated folders',t=>{
  const {directory,state,register}=fixture(t);
  mkdirSync(join(state,'durable-streams'));
  register('projectdnd','{invalid');
  const result=findLocalDatabase(db,directory);
  assert.equal(result.localServer,null);
  assert.match(result.localDatabaseIssue,/projectdnd.*server.json/);
});

test('missing registration is distinct from an external database',t=>{
  const {directory}=fixture(t);
  assert.match(findLocalDatabase(db,directory).localDatabaseIssue,/没有找到/);
  assert.deepEqual(findLocalDatabase({host:'nas.local',port:5432},directory),{
    localServer:null,databaseStateDir:null,localDatabaseIssue:null,
  });
});

test('reports the real filesystem error when the registration path is not a directory',t=>{
  const {directory}=fixture(t);
  const invalidRoot=join(directory,'invalid-root');
  mkdirSync(invalidRoot);
  writeFileSync(join(invalidRoot,'prisma-dev-nodejs'),'file instead of directory');
  const result=findLocalDatabase(db,invalidRoot);
  assert.ok(result.localDatabaseIssueCode);
  assert.match(result.localDatabaseIssue,/不存在|无法读取/);
});

test('prefers the preserved project database over the user profile database',t=>{
  const project=fixture(t),profile=fixture(t);
  project.register('projectdnd',JSON.stringify(server));
  profile.register('old-profile',JSON.stringify({...server,name:'old-profile'}));
  const result=findLauncherDatabase(db,project.directory,profile.directory);
  assert.deepEqual(result.localServer,server);
  assert.equal(result.localDatabaseAppData,project.directory);
});

test('does not silently load the old profile after the project registration is damaged',t=>{
  const project=fixture(t),profile=fixture(t);
  project.register('projectdnd','{invalid');
  profile.register('projectdnd',JSON.stringify(server));
  const result=findLauncherDatabase(db,project.directory,profile.directory);
  assert.equal(result.localServer,null);
  assert.equal(result.databaseStateDir,project.state);
  assert.match(result.localDatabaseIssue,/server.json/);
});
