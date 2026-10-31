import { gsap } from "gsap";

/**
 * Motion for the soft-bubble look. Transforms and opacity only; nothing moves when the system asks for reduced motion.
 * Every helper returns a cleanup that stops its tweens and restores the inline styles it set.
 */
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const noop = () => {};

/** Blocks marked data-in float up one after another, with a small overshoot. */
export function enter(root: Element | null): () => void {
  if (!root || reduced()) return noop;
  const ctx = gsap.context(() => {
    gsap.from(root.querySelectorAll("[data-in]"), { y: 18, opacity: 0, scale: 0.98, duration: 0.6, ease: "back.out(1.5)", stagger: 0.07, clearProps: "transform,opacity" });
  }, root);
  return () => ctx.revert();
}

/** The progress orb: the water rises to its level once, then its surface keeps turning slowly like a wave. */
export function orb(el: Element | null): () => void {
  if (!el || reduced()) return noop;
  const ctx = gsap.context(() => {
    const [w1, w2] = el.querySelectorAll<HTMLElement>(".orb-water, .orb-water2");
    if (!w1 || !w2) return;
    const h = (el as HTMLElement).offsetHeight;
    gsap.from([w1, w2], { y: h, duration: 1.4, ease: "power3.out", delay: 0.25 });
    gsap.to(w1, { rotation: 360, duration: 11, ease: "none", repeat: -1 });
    gsap.to(w2, { rotation: -360, duration: 15, ease: "none", repeat: -1 });
  }, el);
  return () => ctx.revert();
}

/** Finish screen: the bubble pops in and a handful of small bubbles drift up from behind it. */
export function celebrate(root: Element | null): () => void {
  if (!root || reduced()) return noop;
  const bubble = root.querySelector(".bubble");
  if (!bubble) return noop;
  const colors = ["var(--accent-2)", "var(--peach)", "var(--mint)", "var(--butter)", "var(--rose)"];
  const fizz: HTMLElement[] = [];
  const box = (root as HTMLElement).getBoundingClientRect();
  const b = (bubble as HTMLElement).getBoundingClientRect();
  const cx = b.left - box.left + b.width / 2;
  const cy = b.top - box.top + b.height / 2;
  for (let i = 0; i < 14; i++) {
    const d = document.createElement("span");
    const size = 8 + Math.random() * 16;
    d.className = "fizz";
    d.setAttribute("aria-hidden", "true");
    Object.assign(d.style, { width: `${size}px`, height: `${size}px`, left: `${cx - size / 2}px`, top: `${cy - size / 2}px` });
    d.style.setProperty("--c", colors[i % colors.length]);
    root.appendChild(d);
    fizz.push(d);
  }
  const ctx = gsap.context(() => {
    const tl = gsap.timeline();
    tl.from(bubble, { scale: 0.3, opacity: 0, duration: 0.7, ease: "elastic.out(1, 0.55)" });
    tl.to(fizz, { opacity: 0.9, duration: 0.25, stagger: 0.03 }, 0.15);
    fizz.forEach((d, i) => {
      const angle = (-90 + (Math.random() - 0.5) * 150) * (Math.PI / 180);
      const dist = 70 + Math.random() * 90;
      tl.to(d, { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, scale: 0.6 + Math.random() * 0.6, duration: 1.4 + Math.random() * 0.6, ease: "power2.out" }, 0.15 + i * 0.03);
      tl.to(d, { opacity: 0, duration: 0.5 }, 1.1 + i * 0.03);
    });
  }, root);
  return () => {
    ctx.revert();
    fizz.forEach((d) => d.remove());
  };
}
