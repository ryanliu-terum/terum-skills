import { PublishRunDialog } from '../components/domain/PublishRunDialog';
import { usePublishRun } from './publish-run-context';

/** The app-level board draws only from the provider snapshot, never from route state or a query. */
export function PublishRunDialogHost() {
 const { current, dialogOpen, dismiss, stop } = usePublishRun();
 return dialogOpen && current ? <PublishRunDialog current={current} onClose={dismiss} onStop={() => void stop()} /> : null;
}
