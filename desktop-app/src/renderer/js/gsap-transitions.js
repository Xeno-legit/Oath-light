/* ═══════════════════════════════════════════════════════════════════
   Pure Path — GSAP Transition System
   Reusable animation factories for page & component transitions
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathTransitions = (function () {
  'use strict';

  const EASE_SPRING  = 'elastic.out(1, 0.55)';
  const EASE_SMOOTH  = 'power3.out';
  const EASE_SNAPPY  = 'power2.out';

  /* ─── Page Enter/Exit ──────────────────────────────────────────── */
  function pageEnter(el, done) {
    if (!el) return;
    gsap.fromTo(el,
      { opacity: 0, y: 24, scale: 0.98 },
      {
        opacity: 1, y: 0, scale: 1,
        duration: 0.55,
        ease: EASE_SMOOTH,
        onComplete: done || (() => {}),
      }
    );
  }

  function pageExit(el, done) {
    if (!el) return;
    gsap.to(el, {
      opacity: 0, y: -14, scale: 0.98,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: done || (() => {}),
    });
  }

  /* ─── Card Stagger Entrance ────────────────────────────────────── */
  function staggerCards(cards, delay) {
    if (!cards || cards.length === 0) return;
    gsap.fromTo(cards,
      { opacity: 0, y: 28, scale: 0.96 },
      {
        opacity: 1, y: 0, scale: 1,
        duration: 0.5,
        ease: EASE_SMOOTH,
        stagger: 0.07,
        delay: delay || 0.08,
      }
    );
  }

  /* ─── Counter Animation ────────────────────────────────────────── */
  function animateCounter(el, target, duration) {
    if (!el) return;
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target,
      duration: duration || 1.4,
      ease: EASE_SNAPPY,
      onUpdate: () => {
        el.textContent = Math.floor(obj.val).toLocaleString();
      },
    });
  }

  /* ─── Sidebar Expand / Collapse ────────────────────────────────── */
  function sidebarExpand(sidebar, labels) {
    gsap.to(sidebar, {
      width: 240,
      duration: 0.45,
      ease: EASE_SPRING,
    });

    if (labels && labels.length > 0) {
      gsap.to(labels, {
        opacity: 1,
        x: 0,
        filter: 'blur(0px)',
        duration: 0.35,
        ease: EASE_SMOOTH,
        stagger: 0.04,
        delay: 0.08,
      });
    }
  }

  function sidebarCollapse(sidebar, labels) {
    if (labels && labels.length > 0) {
      gsap.to(labels, {
        opacity: 0,
        x: -6,
        filter: 'blur(4px)',
        duration: 0.2,
        ease: 'power2.in',
      });
    }

    gsap.to(sidebar, {
      width: 72,
      duration: 0.35,
      ease: EASE_SMOOTH,
      delay: 0.05,
    });
  }

  /* ─── Fade In ──────────────────────────────────────────────────── */
  function fadeIn(el, delay) {
    if (!el) return;
    gsap.fromTo(el,
      { opacity: 0 },
      { opacity: 1, duration: 0.4, ease: EASE_SMOOTH, delay: delay || 0 }
    );
  }

  /* ─── Slide Up ─────────────────────────────────────────────────── */
  function slideUp(el, delay) {
    if (!el) return;
    gsap.fromTo(el,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.5, ease: EASE_SMOOTH, delay: delay || 0 }
    );
  }

  /* ─── Scale Pop ────────────────────────────────────────────────── */
  function scalePop(el) {
    if (!el) return;
    gsap.fromTo(el,
      { scale: 0.9, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.4, ease: EASE_SPRING }
    );
  }

  /* ─── Modal show/hide  ─────────────────────────────────────────── */
  function showModal(overlay) {
    if (!overlay) return;
    overlay.classList.add('visible');
  }

  function hideModal(overlay, done) {
    if (!overlay) return;
    overlay.classList.remove('visible');
    setTimeout(done || (() => {}), 350);
  }

  /* ─── Typewriter ───────────────────────────────────────────────── */
  function typewriter(el, text, speed) {
    if (!el) return;
    el.textContent = '';
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        el.textContent += text[i];
        i++;
      } else {
        clearInterval(interval);
      }
    }, speed || 30);
  }

  return {
    pageEnter,
    pageExit,
    staggerCards,
    animateCounter,
    sidebarExpand,
    sidebarCollapse,
    fadeIn,
    slideUp,
    scalePop,
    showModal,
    hideModal,
    typewriter,
  };

})();
