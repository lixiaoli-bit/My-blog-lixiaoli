(() => {
  const key = 'my-blog-deployment-checks-v1';
  const checks = Array.from(document.querySelectorAll('[data-check]'));
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Progress is optional. */ }
  for (const input of checks) input.checked = saved?.[input.dataset.check] === true;
  const count = () => { document.getElementById('check-count').textContent = `完成检查 ${checks.filter(input => input.checked).length} / ${checks.length}`; };
  count();
  for (const input of checks) input.addEventListener('change', () => {
    count(); try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(checks.map(item => [item.dataset.check, item.checked])))); } catch { /* Browser storage can be disabled. */ }
  });
  document.getElementById('reset-checks').addEventListener('click', () => {
    checks.forEach(input => input.checked = false); try { localStorage.removeItem(key); } catch { /* Optional storage. */ } count();
  });
  let feedbackTimer;
  const feedback = text => {
    const output = document.getElementById('guide-feedback'); output.textContent = text; output.hidden = false;
    clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => output.hidden = true, 2500);
  };
  for (const button of document.querySelectorAll('.copy')) button.addEventListener('click', async () => {
    const text = button.parentElement.querySelector('code').textContent;
    try { await navigator.clipboard.writeText(text); feedback('已复制命令'); }
    catch { feedback('浏览器未允许复制，请选中命令手动复制'); }
  });
  const links = Array.from(document.querySelectorAll('.sidebar nav a'));
  if ('IntersectionObserver' in window) {
    const visible = new Map();
    // Keep one observer for all chapters, independent of chapter length.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
      const first = links.find(link => visible.get(link.hash.slice(1)));
      if (first) for (const link of links) { if (link === first) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); }
    }, { rootMargin: '-110px 0px -55% 0px', threshold: 0 });
    document.querySelectorAll('.chapter').forEach(chapter => observer.observe(chapter));
  }
})();
