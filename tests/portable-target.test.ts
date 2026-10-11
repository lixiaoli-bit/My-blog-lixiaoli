import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { acquirePortableLock, bundlePath, selectPortableTarget } from '../scripts/portable-target.mjs';

const release = path.resolve('release');
const running = (slot: string) => [{ProcessId: 123, ExecutablePath: path.join(release, slot, '白衣卿相.exe')}];
const tempRoot = path.resolve('outputs/portable-rotation-tests');
fs.mkdirSync(tempRoot,{recursive:true});
const tempDirs: string[]=[];
afterEach(()=> {
  for(const dir of tempDirs.splice(0)) {
    if(path.dirname(path.resolve(dir))!==tempRoot) throw Error('Unexpected test cleanup target');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
const temporary = () => {const dir=fs.mkdtempSync(path.join(tempRoot,'case-'));tempDirs.push(dir);return dir;};

describe('inactive portable publishing',()=> {
  it('chooses the alternate directory when either version is running',()=> {
    expect(selectPortableTarget(release,running('portable'))).toBe('portable2');
    expect(selectPortableTarget(release,running('portable2'))).toBe('portable');
  });
  it('defaults to portable when neither is running and ignores similarly named directories',()=> {
    expect(selectPortableTarget(release,[])).toBe('portable');
    expect(selectPortableTarget(release,running('portable-backup'))).toBe('portable');
  });
  it('fails without terminating clients when both directories are busy',()=> {
    expect(()=>selectPortableTarget(release,[...running('portable'),...running('portable2')])).toThrow('都在运行');
  });
  it('blocks an explicit running target and accepts an idle explicit target',()=> {
    expect(()=>selectPortableTarget(release,running('portable'),'portable')).toThrow('正在运行');
    expect(selectPortableTarget(release,running('portable'),'portable2')).toBe('portable2');
  });
  it('recognizes Windows case differences and child executables',()=> {
    expect(selectPortableTarget(release,[{ExecutablePath:path.join(release,'PORTABLE','resources','helper.exe').toUpperCase()}])).toBe('portable2');
  });
  it('rejects traversal and paths outside release',()=> {
    for(const name of ['../portable','portable/child','C:\\other','', '.portable']) expect(()=>bundlePath(release,name)).toThrow();
  });
  it('can choose a different idle slot on the final fresh process snapshot',()=> {
    expect(selectPortableTarget(release,running('portable'))).toBe('portable2');
    expect(selectPortableTarget(release,running('portable2'))).toBe('portable');
    expect(()=>selectPortableTarget(release,running('portable2'),'portable2')).toThrow();
  });
});
describe('portable build lock',()=> {
  it('prevents concurrent builds and permits reuse after release',()=> {
    const dir=temporary(),lock=acquirePortableLock(dir);
    try {expect(()=>acquirePortableLock(dir)).toThrow('已有便携构建');} finally {lock.release();}
    const next=acquirePortableLock(dir);next.release();
    expect(fs.existsSync(path.join(dir,'.portable-build.lock'))).toBe(false);
  });
  it('lends a live lock to its bundle child without child cleanup deleting it',()=> {
    const dir=temporary(),lock=acquirePortableLock(dir),previous=process.env.BYQX_PORTABLE_LOCK_TOKEN;
    process.env.BYQX_PORTABLE_LOCK_TOKEN=lock.token;
    try {const child=acquirePortableLock(dir);child.release();expect(fs.existsSync(path.join(dir,'.portable-build.lock'))).toBe(true);}
    finally {if(previous===undefined) delete process.env.BYQX_PORTABLE_LOCK_TOKEN; else process.env.BYQX_PORTABLE_LOCK_TOKEN=previous;lock.release();}
  });
  it('rejects a malformed owner instead of discarding an uncertain lock',()=> {
    const dir=temporary();fs.writeFileSync(path.join(dir,'.portable-build.lock'),JSON.stringify({pid:-1}));
    expect(()=>acquirePortableLock(dir)).toThrow('构建锁不合法');
  });
});
