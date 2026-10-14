import type { UiRenderers } from './render-context';
import { ChartRenderer } from './renderers/chart';
import { ChoiceRenderer, ChoicesRenderer } from './renderers/choices';
import { CodeBlockRenderer, CompareRenderer, GalleryRenderer, ImageRenderer, SourceRenderer, SourcesRenderer } from './renderers/content';
import { EntityListRenderer, EntryRenderer, StatRenderer, StatsRenderer, TableRenderer } from './renderers/data';
import {
    ButtonRenderer,
    ChecklistRenderer,
    ItemRenderer,
    SegmentedRenderer,
    SelectRenderer,
    SliderRenderer,
    SwitchRenderer,
    TextFieldRenderer
} from './renderers/inputs';
import { CommitRenderer, DiffRenderer, FileRenderer, NodeRenderer } from './renderers/links';
import { SectionRenderer, SectionsRenderer, TabRenderer, TabsRenderer } from './renderers/structure';
import {
    CalloutRenderer,
    EventRenderer,
    ProgressRenderer,
    StepRenderer,
    StepsRenderer,
    SummaryRenderer,
    TagRenderer,
    TimelineRenderer
} from './renderers/text';

/*
 * A renderer for every component of the catalog; a name missing here fails the typecheck. Null draws
 * nothing for the node itself: the runtime resolves Show and Each before rendering, and Column and
 * Option are metadata their parent reads from its node (a table its columns, Segmented and Select their options).
 */
export const UI_RENDERERS: UiRenderers = {
    Summary: SummaryRenderer,
    Callout: CalloutRenderer,
    Tag: TagRenderer,
    Progress: ProgressRenderer,
    Steps: StepsRenderer,
    Step: StepRenderer,
    Timeline: TimelineRenderer,
    Event: EventRenderer,
    Stats: StatsRenderer,
    Stat: StatRenderer,
    EntityList: EntityListRenderer,
    Entry: EntryRenderer,
    Table: TableRenderer,
    Column: null,
    Chart: ChartRenderer,
    Tabs: TabsRenderer,
    Tab: TabRenderer,
    Sections: SectionsRenderer,
    Section: SectionRenderer,
    CodeBlock: CodeBlockRenderer,
    Image: ImageRenderer,
    Gallery: GalleryRenderer,
    Compare: CompareRenderer,
    Sources: SourcesRenderer,
    Source: SourceRenderer,
    File: FileRenderer,
    Diff: DiffRenderer,
    Commit: CommitRenderer,
    Node: NodeRenderer,
    Checklist: ChecklistRenderer,
    Item: ItemRenderer,
    Switch: SwitchRenderer,
    Slider: SliderRenderer,
    Segmented: SegmentedRenderer,
    Select: SelectRenderer,
    Option: null,
    TextField: TextFieldRenderer,
    Button: ButtonRenderer,
    Show: null,
    Each: null,
    Choices: ChoicesRenderer,
    Choice: ChoiceRenderer
};
