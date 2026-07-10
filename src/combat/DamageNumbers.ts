import * as THREE from 'three';
import { POOL_DAMAGE_NUMBERS } from '../config';
import { events } from '../core/events';

/**
 * Floating cartoon damage numbers: pooled canvas-text sprites that pop out of
 * hits, drift up, and shrink away. Chunky white digits with a dark outline so
 * they read on bright skies. Self-subscribes to 'hit' events.
 */

const CANVAS_W = 128;
const CANVAS_H = 64;

interface Slot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  life: number;
  vx: number;
  vy: number;
}

export class DamageNumbers {
  private slots: Slot[] = [];
  private next = 0;
  private unsub: () => void;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < POOL_DAMAGE_NUMBERS; i += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.7, 0.85, 1);
      sprite.visible = false;
      sprite.renderOrder = 50;
      scene.add(sprite);
      this.slots.push({ sprite, material, texture, canvas, life: 0, vx: 0, vy: 0 });
    }

    this.unsub = events.on('hit', ({ pos, damage, victimIsPlayer }) => {
      this.spawn(pos.x, pos.y, Math.round(damage), victimIsPlayer);
    });
  }

  spawn(x: number, y: number, amount: number, onPlayer: boolean): void {
    const slot = this.slots[this.next]!;
    this.next = (this.next + 1) % this.slots.length;

    const ctx = slot.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = '800 44px "Avenir Next", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#1e2a4a';
    const text = `${amount}`;
    ctx.strokeText(text, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = onPlayer ? '#ff5a5a' : '#ffffff';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
    slot.texture.needsUpdate = true;

    slot.sprite.position.set(x, y + 0.6, 1.5);
    slot.sprite.visible = true;
    slot.material.opacity = 1;
    slot.life = 0.75;
    slot.vx = (Math.random() - 0.5) * 1.6; // det-ok: view-only (floating UI sprite)
    slot.vy = 3.4 + Math.random() * 0.8; // det-ok: view-only (floating UI sprite)
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.sprite.visible = false;
        continue;
      }
      slot.vy -= 4.5 * dt;
      slot.sprite.position.x += slot.vx * dt;
      slot.sprite.position.y += slot.vy * dt;
      const t = slot.life / 0.75;
      slot.material.opacity = t < 0.4 ? t / 0.4 : 1;
      const s = 0.9 + 0.35 * t;
      slot.sprite.scale.set(1.7 * s, 0.85 * s, 1);
    }
  }

  dispose(): void {
    this.unsub();
    for (const slot of this.slots) {
      this.scene.remove(slot.sprite);
      slot.material.dispose();
      slot.texture.dispose();
    }
    this.slots.length = 0;
  }
}
