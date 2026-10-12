import { initInteractiveHtml } from '../lib/interactive-html-client';
initInteractiveHtml();
document.addEventListener('astro:page-load', initInteractiveHtml);
document.addEventListener('article:body-updated', initInteractiveHtml);
