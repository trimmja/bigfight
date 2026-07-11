import type { Game } from './Game';
import { LEVELS, levelById } from './data/levels';
import type { MaterialId } from './data/types';
import { startOnlineFlow } from './flowOnline';
import { CharacterSelectScreen } from './screens/CharacterSelectScreen';
import { GameplayScreen } from './screens/GameplayScreen';
import { LevelMapScreen } from './screens/LevelMapScreen';
import { MarketScreen } from './screens/MarketScreen';
import { PauseOverlay } from './screens/PauseOverlay';
import { ReplayLabScreen } from './screens/ReplayLabScreen';
import { ResultsScreen, type LevelResult } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TitleScreen } from './screens/TitleScreen';
import { WeaponSelectScreen } from './screens/WeaponSelectScreen';

/**
 * Screen navigation in one place. Every screen gets callbacks from here, so
 * screens stay decoupled and the campaign loop reads top-to-bottom:
 * title → map → character → weapon → fight → results → (market) → map …
 */

export function goTitle(game: Game): void {
  game.screens.replace(new TitleScreen(
    () => goLevelMap(game),
    () => startOnlineFlow(game, () => goTitle(game)),
  ));
}

/** `?replaylab` dev tool — sim-determinism harness (see ReplayLabScreen). */
export function goReplayLab(game: Game): void {
  game.screens.replace(new ReplayLabScreen());
}

export function goLevelMap(game: Game): void {
  game.screens.replace(
    new LevelMapScreen({
      onPickLevel: (levelId) => goCharacterSelect(game, levelId),
      onSettings: () =>
        game.screens.push(
          new SettingsScreen(
            () => game.screens.pop(),
            // After a reset the map below is stale — rebuild it fresh.
            () => goLevelMap(game),
          ),
        ),
    }),
  );
}

export function goCharacterSelect(game: Game, levelId: number): void {
  game.screens.replace(
    new CharacterSelectScreen({
      onPick: (characterId) => goWeaponSelect(game, levelId, characterId),
      onBack: () => goLevelMap(game),
    }),
  );
}

export function goWeaponSelect(game: Game, levelId: number, characterId: string): void {
  game.screens.replace(
    new WeaponSelectScreen({
      onPick: (weaponId) => startLevel(game, levelId, characterId, weaponId),
      onBack: () => goCharacterSelect(game, levelId),
    }),
  );
}

export function startLevel(
  game: Game,
  levelId: number,
  characterId: string,
  weaponId: string,
): void {
  game.screens.replace(
    new GameplayScreen({
      levelId,
      characterId,
      weaponId,
      onLevelEnd: (result) => handleLevelEnd(game, result, characterId, weaponId),
      onPause: () =>
        game.screens.push(
          new PauseOverlay({
            onRestart: () => startLevel(game, levelId, characterId, weaponId),
            onQuit: () => goLevelMap(game),
          }),
        ),
    }),
  );
}

function handleLevelEnd(
  game: Game,
  result: LevelResult,
  characterId: string,
  weaponId: string,
): void {
  const save = game.save;

  // Loot is kept win or lose (Ryder's rule: losing still makes progress).
  save.gold += result.goldEarned;
  for (const [id, count] of Object.entries(result.materialsEarned) as [MaterialId, number][]) {
    save.materials[id] += count ?? 0;
  }
  const firstClear = result.won && result.levelId > save.levelsBeaten;
  if (firstClear) save.levelsBeaten = result.levelId;
  game.persist();

  const unlocks = firstClear ? levelById(result.levelId).unlocks : undefined;

  game.screens.replace(
    new ResultsScreen(result, unlocks, {
      onMarket: () => game.screens.replace(new MarketScreen(() => goLevelMap(game))),
      onContinue: () => {
        // After a win, Continue takes you toward the next level if there is one.
        if (result.won && result.levelId < LEVELS.length) goCharacterSelect(game, result.levelId + 1);
        else goLevelMap(game);
      },
      onRetry: () => startLevel(game, result.levelId, characterId, weaponId),
    }),
  );
}
