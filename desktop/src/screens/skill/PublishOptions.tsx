import { Small, SectionLabel } from '../../components/domain/Primitives';
import { InlineChoice, WorkflowField } from '../../components/domain/WorkflowControls';
import { CATEGORY_ASK, MARKETPLACE_ONLY, targetOptions } from './publish-defaults';
import type { PublishDefaults } from './publish-defaults';

/**
 * The two publish choices inside the publish dialogs (Settings ▸ Publishing ▸ Defaults, 2026-09-14). Target is
 * always a control here, starting on the Settings default. "Marketplace only" sends no `--project` at all — the
 * version folder alone is what puts the skill in the team's marketplace. Category is a field only when the default
 * says "Ask before publishing"; empty means the CLI's model suggestion. A bulk publish keeps categories per skill,
 * so it draws no field and says so.
 */
export function PublishOptions({ defaults, target, onTarget, category, onCategory, bulk = false }: { defaults: PublishDefaults; target: string; onTarget: (value: string) => void; category: string; onCategory: (value: string) => void; bulk?: boolean }) {
  const options = targetOptions(defaults.projects); // the marketplace alone, then each team project it can ALSO be listed under
  return <div className="board-column publish-options" style={{ gap: 10 }}>
    <div className="board-column" style={{ gap: 6 }}>
      <SectionLabel>Publish to</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <InlineChoice label="Publish to" value={options.includes(target) ? target : MARKETPLACE_ONLY} options={options} onChange={onTarget} />
        <Small>{bulk ? 'Every skill in this batch' : 'A project list to add on top of the marketplace'} · default in Settings ▸ Publishing</Small>
      </div>
    </div>
    {defaults.category === CATEGORY_ASK ? <div className="board-column" style={{ gap: 6 }}>
      <SectionLabel>Category</SectionLabel>
      {bulk
        ? <Small>Suggested per skill by the model; a category declared in a SKILL.md is kept.</Small>
        : <><WorkflowField aria-label="Category" list="publish-category-options" placeholder="Leave empty to let the model suggest" value={category} onChange={event => onCategory(event.target.value)} style={{ width: 260 }} />
          <datalist id="publish-category-options">{(defaults.categories ?? []).map(name => <option key={name} value={name} />)}</datalist>
          <Small>Written into SKILL.md as terum-category; a category already declared there is kept.</Small></>}
    </div> : null}
  </div>;
}
