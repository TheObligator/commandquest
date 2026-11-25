// Settings for one triggered ability: a panel beside its row in a card's right-click menu, and in an
// opened stack item. The marker next to an ability says what's set; nothing shows on the card itself.
import { createContext, useContext, type ReactNode } from "react";
import type { MenuItem } from "../components/CardMenu";
import { abilityName, abilityText, isEveryCopy, isSet, settingFor, type AbilitySetting, type AbilitySettings, type CardAbility, type Decision, type SavedAbility } from "./abilities";

export interface AbilityControls {
  settings?: AbilitySettings;
  /** What's saved with the deck you're playing; undefined when it's not one of your saved decks. */
  saved?: SavedAbility[];
  change: (key: string, change: { autoYield?: boolean; decision?: Decision; everyCopy?: boolean }) => void;
  /** Save this setting with the deck (nothing set: take it out). */
  save: (card: string, text: string, setting: AbilitySetting) => void;
}

const AbilityContext = createContext<AbilityControls>({ change: () => {}, save: () => {} });
export const AbilityProvider = AbilityContext.Provider;

export function AbilityMarks({ setting }: { setting: { autoYield?: boolean; decision?: Decision } }) {
  if (!isSet(setting)) return null;
  return (
    <span className="ab-marks">
      {setting.autoYield && <b className="ab-mark yield">auto-yield</b>}
      {setting.decision === "ACCEPT" && <b className="ab-mark yes">always yes</b>}
      {setting.decision === "DECLINE" && <b className="ab-mark no">always no</b>}
    </span>
  );
}

/** The marker for an ability in this game. */
export function AbilityMark({ abilityKey }: { abilityKey: string }) {
  return <AbilityMarks setting={settingFor(useContext(AbilityContext).settings, abilityKey)} />;
}

/** The menu rows for a card's triggered abilities, each with its settings beside it. */
export function abilityItems(abilities: CardAbility[], card: string): MenuItem[] {
  return abilities.map((a) => ({
    label: abilityName(a.text),
    onSelect: () => {},
    badge: <AbilityMark abilityKey={a.key} />,
    panel: <AbilityPanel ability={a} card={card} showText />,
  }));
}

export function AbilityPanel({ ability, card, showText }: { ability: CardAbility; card: string; showText?: boolean }) {
  const { settings, saved, change, save } = useContext(AbilityContext);
  const now = settingFor(settings, ability.key);
  const every = isEveryCopy(settings, ability.key);
  const text = abilityText(ability.key);
  const inDeck = !!saved?.some((s) => s.text === text) && every;
  const set = (next: Partial<AbilitySetting>) => {
    change(ability.key, next);
    if (inDeck) save(card, text, { ...now, ...next });
  };
  return (
    <div className="ab-panel">
      {showText && <p className="ab-text">{ability.text}</p>}
      <Check kind="menuitemcheckbox" on={now.autoYield} hint="don't stop for it" onClick={() => set({ autoYield: !now.autoYield })}>Auto-yield</Check>
      {ability.mayAsk && (
        <div className="ab-group" role="group" aria-label="When it says you may">
          <div className="card-menu-title">“You may”</div>
          <Check kind="menuitemradio" on={now.decision === "ASK"} onClick={() => set({ decision: "ASK" })}>Ask each time</Check>
          <Check kind="menuitemradio" on={now.decision === "ACCEPT"} onClick={() => set({ decision: "ACCEPT" })}>Always yes</Check>
          <Check kind="menuitemradio" on={now.decision === "DECLINE"} onClick={() => set({ decision: "DECLINE" })}>Always no</Check>
        </div>
      )}
      <div className="ab-group">
        <Check kind="menuitemcheckbox" on={every} disabled={inDeck} hint={inDeck ? "saved with the deck" : undefined} onClick={() => change(ability.key, { everyCopy: !every })}>
          Every copy of this ability
        </Check>
        {ability.mine && saved && (
          <Check
            kind="menuitemcheckbox"
            on={inDeck}
            disabled={!inDeck && (!every || !isSet(now))}
            hint={inDeck ? undefined : !every ? "only for every copy" : !isSet(now) ? "nothing set yet" : undefined}
            onClick={() => save(card, text, inDeck ? { autoYield: false, decision: "ASK" } : now)}
          >
            Save with this deck
          </Check>
        )}
      </div>
    </div>
  );
}

export function Check(props: { kind: "menuitemcheckbox" | "menuitemradio"; on: boolean; disabled?: boolean; hint?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button role={props.kind} aria-checked={props.on} disabled={props.disabled} className="ab-check" onClick={props.onClick}>
      <i className={`${props.kind === "menuitemradio" ? "radio" : "box"}${props.on ? " on" : ""}`} aria-hidden />
      <span>{props.children}</span>
      {props.hint && <small>{props.hint}</small>}
    </button>
  );
}
