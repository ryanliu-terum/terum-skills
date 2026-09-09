# Backend reading rules

The CLI frame result is authoritative; the browser mock alone supplies the design's example data.
Preferences own chrome only, and the real Inbox remains hidden: `surfaces.inbox` is false and `inbox()` is a typed gap, not an empty successful feed.

## Reading rules

- CP-25: A divergence decision must show the exact source and quarantine destination and obtain consent before any move; without those paths the app cannot promise or perform a resolution.
- CP-41: When a selected Inbox id disappears on refetch, retain the pane, state only that the item is no longer in the list, and offer only Back to the list.
- RM-12: Search renders only returned kinds and hits; no results describes the query result, never the existence of all team skills, people or projects.
- RM-33: A pending destructive action stays pending until a CLI result and refreshed read model prove completion; a lock failure is an error, never quiet success.
- RM-34: Every unrecognized ask opens the Prompter dialog and waits for a human answer; setup supplies no scripted answers.
- RM-35: Frame mode carries interactive consent; print-only GitHub login advice is rendered, never auto-answered or run by the app.
- IB-04: Activity requires committed event evidence and real ISO instants; neither current installed state nor a local seen preference proves a repository action.
- IB-09: Search, filtering and sorting are in-memory operations over a served feed, never an automatic sync or timer-driven read.

`launch:consumedWrittenAt` is written only after setup returns success or a typed decline. The CLI at this tree reports stdin closing at its first ask as an ordinary failure, so that recording correctly remains unconsumed.
The platform supplies OS at launch; hostname remains `—` until a CLI payload supplies it. No machine identity is persisted.
