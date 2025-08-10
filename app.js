
document.addEventListener('DOMContentLoaded', async () => {
  const spacer = document.getElementById('keyboard-spacer');

  function ensureVisible(el) {
    if (!el) return;
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }

  ['amount','date','category'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => {
      document.body.classList.add('kbd-open');
      ensureVisible(el);
    });
    el.addEventListener('blur', () => {
      setTimeout(() => document.body.classList.remove('kbd-open'), 250);
    });
  });

  if (window.visualViewport) {
    const onVV = () => {
      const vv = window.visualViewport;
      const overlap = Math.max(0, (window.innerHeight - (vv.height + vv.offsetTop)));
      spacer.style.height = overlap > 0 ? (overlap + 80) + 'px' : '0px';
    };
    visualViewport.addEventListener('resize', onVV);
    visualViewport.addEventListener('scroll', onVV);
    onVV();
  }
});
