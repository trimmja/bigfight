import * as THREE from 'three';
import type { Player } from '../entities/Player';

/**
 * Multiplayer identity markers (view-only): a colored ring under each
 * fighter's feet, plus a floating "P1"-style badge for the first seconds of
 * the match and after every respawn — answers "which one is me?" instantly.
 */

const RING = new THREE.TorusGeometry(0.55, 0.07, 8, 28);
const BADGE_SECONDS = 3;

type Marker = {
  ring: THREE.Mesh;
  badge: THREE.Sprite;
  ringMaterial: THREE.MeshBasicMaterial;
  badgeMaterial: THREE.SpriteMaterial;
  badgeTimer: number;
  wasAlive: boolean;
};

export class SlotMarkers {
  private readonly markers: Marker[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly players: readonly Player[],
    slotColors: readonly number[],
  ) {
    for (let i = 0; i < players.length; i += 1) {
      const color = slotColors[i] ?? 0xffffff;
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(RING, ringMaterial);
      ring.rotation.x = Math.PI / 2;

      const badgeMaterial = new THREE.SpriteMaterial({
        map: badgeTexture(`P${i + 1}`, color),
        transparent: true,
        depthTest: false,
        toneMapped: false,
      });
      const badge = new THREE.Sprite(badgeMaterial);
      badge.scale.set(1.1, 0.62, 1);

      this.scene.add(ring);
      this.scene.add(badge);
      this.markers.push({ ring, badge, ringMaterial, badgeMaterial, badgeTimer: BADGE_SECONDS, wasAlive: true });
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.markers.length; i += 1) {
      const marker = this.markers[i]!;
      const player = this.players[i]!;
      const alive = player.alive;
      if (alive && !marker.wasAlive) marker.badgeTimer = BADGE_SECONDS; // respawned
      marker.wasAlive = alive;

      marker.ring.visible = alive;
      if (alive) {
        marker.ring.position.set(player.body.pos.x, player.body.pos.y + 0.06, 0);
      }

      if (marker.badgeTimer > 0 && alive) {
        marker.badgeTimer = Math.max(0, marker.badgeTimer - dt);
        marker.badge.visible = true;
        const fade = Math.min(1, marker.badgeTimer / 0.5);
        marker.badgeMaterial.opacity = fade;
        marker.badge.position.set(player.body.pos.x, player.body.pos.y + player.body.height + 0.75, 0.5);
      } else {
        marker.badge.visible = false;
      }
    }
  }

  dispose(): void {
    for (const marker of this.markers) {
      this.scene.remove(marker.ring);
      this.scene.remove(marker.badge);
      marker.ringMaterial.dispose();
      marker.badgeMaterial.map?.dispose();
      marker.badgeMaterial.dispose();
    }
    this.markers.length = 0;
  }
}

function badgeTexture(text: string, color: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  roundRect(ctx, 6, 6, 116, 60, 16);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  roundRect(ctx, 6, 6, 116, 60, 16);
  ctx.stroke();
  ctx.font = '800 38px "Avenir Next", "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 64, 38);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
