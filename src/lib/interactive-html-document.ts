import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import type { Element, Root, RootContent } from 'hast';
import { validateInteractiveSource } from './interactive-html';

export const INTERACTIVE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'";
const element = (tagName: string, properties: Element['properties'] = {}, children: Element['children'] = []): Element => ({ type: 'element', tagName, properties, children });
const text = (value: string) => ({ type: 'text' as const, value });
// Runs before user scripts. All capabilities remain local to this opaque iframe.
const bridge = `(()=>{
const token=window.name;
const send=(type,value)=>parent.postMessage({channel:'byqx-interactive',token,type,value},'*');
let sent=0,lastHeight=0,scheduled=false;
const error=value=>{if(sent++<20)send('error',String(value).slice(0,1200));};
addEventListener('error',event=>error(event.message||'脚本运行错误'));
addEventListener('unhandledrejection',event=>error(event.reason?.message||event.reason||'未处理的脚本错误'));
addEventListener('securitypolicyviolation',()=>error('页面依赖外部资源或使用了未开放的能力；请改为自包含 HTML'));
const measure=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;
const body=document.body;if(!body)return;
const h=Math.ceil(Math.max(body.offsetHeight,...Array.from(body.children).filter(el=>!['SCRIPT','STYLE'].includes(el.tagName)).map(el=>el.getBoundingClientRect().bottom-body.getBoundingClientRect().top))+24);
if(Math.abs(h-lastHeight)>2){lastHeight=h;send('height',h);}},100);};
addEventListener('message',event=>{if(event.source!==parent||event.data?.token!==token)return;
if(event.data.type==='theme'){const dark=event.data.value==='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light';}
if(event.data.type==='visibility'){dispatchEvent(new CustomEvent('byqx:visibility',{detail:{visible:event.data.value===true}}));if(event.data.value)measure();}
if(event.data.type==='measure')measure();});
document.addEventListener('click',event=>{const link=event.target.closest?.('a');if(link&&link.getAttribute('href')&&!link.getAttribute('href').startsWith('#')){event.preventDefault();error('交互页面不支持跳转到外部页面');}},true);
addEventListener('keydown',event=>{if(event.key==='Escape')send('escape',null);});
document.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(measure).observe(document.body);send('ready',null);measure();});
})();`;
export function prepareInteractiveDocument(source: string): { document: string; warnings: string[] } {
  validateInteractiveSource(source);
  const parser = unified().use(rehypeParse).use(rehypeStringify);
  const tree = parser.parse(source) as Root;
  const warnings = new Set<string>();
  const walk = (parent: Root | Element) => {
    parent.children = parent.children.filter((child) => {
      if (child.type !== 'element') return true;
      const tag = child.tagName;
      const css = tag === 'style' ? child.children.filter(item => item.type === 'text').map(item => (item as {value: string}).value).join('') : String(child.properties.style || '');
      if (/@import\b|url\(\s*["']?(?!data:)[^\s"')]/i.test(css)) warnings.add('样式包含外部或相对路径资源，内容策略会阻止加载；请内嵌资源');
      if (['iframe','frame','frameset','object','embed','base'].includes(tag) ||
          (tag === 'meta' && child.properties.httpEquiv)) {
        warnings.add('页面包含嵌套页面、base 或 http-equiv 配置，运行时已禁用'); return false;
      }
      if ((tag === 'script' && child.properties.src) || tag === 'link') {
        warnings.add('页面依赖外部脚本或样式；请将内容内嵌后重新运行'); return false;
      }
      for (const property of ['src','srcSet','poster','background','action','formAction']) {
        const value = child.properties[property];
        if (value && !(typeof value === 'string' && /^data:/i.test(value) && ['img','audio','video','source'].includes(tag))) {
          delete child.properties[property]; warnings.add('外部或相对路径资源已禁用；第一版只支持自包含页面');
        }
      }
      if (tag === 'a' && typeof child.properties.href === 'string' && !child.properties.href.startsWith('#')) {
        delete child.properties.href; delete child.properties.target; warnings.add('外部链接已禁用');
      }
      walk(child); return true;
    }) as RootContent[] & Element['children'];
  };
  walk(tree);
  const html = tree.children.find((child): child is Element => child.type === 'element' && child.tagName === 'html')!;
  const head = html.children.find((child): child is Element => child.type === 'element' && child.tagName === 'head')!;
  head.children.unshift(
    element('meta', { charSet: 'utf-8' }),
    element('meta', { httpEquiv: ['Content-Security-Policy'], content: INTERACTIVE_CSP }),
    element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    element('style', {}, [text('html{--paper:#fbf7ee;--ink:#222;--accent:#ff5a1f;background:var(--paper);color:var(--ink);color-scheme:light}html[data-theme=dark]{--paper:#202020;--ink:#eee;color-scheme:dark}body{margin:0;padding:16px;font-family:system-ui,sans-serif;box-sizing:border-box;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,canvas,svg{max-width:100%}button,input,select,textarea{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid var(--accent)}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}')]),
    element('script', {}, [text(bridge)]),
  );
  return { document: String(parser.stringify(tree)), warnings: [...warnings] };
}
