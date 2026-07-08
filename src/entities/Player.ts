import { PLAYER_STOCKS, RESPAWN_INVULN } from '../config';
import type { IInput } from '../contracts';
import type { CharacterDef } from '../data/types';
import type { WorldCtx } from './Entity';
import { Fighter } from './Fighter';

export class Player extends Fighter {
  stocks = PLAYER_STOCKS;

  constructor(def: CharacterDef, private readonly input: IInput) {
    super(def, 'player');
  }

  override update(ctx: WorldCtx, dt: number): void {
    const state = this.input.state;
    this.intents.moveX = state.moveX;
    this.intents.moveY = state.moveY;
    this.intents.jumpPressed = state.jumpPressed;
    this.intents.attackPressed = state.attackPressed;
    super.update(ctx, dt);
  }

  respawn(ctx: WorldCtx): void {
    this.koReset(ctx.stage.respawnPoint);
    this.invulnTimer = RESPAWN_INVULN;
    this.damage = 0;
  }
}
