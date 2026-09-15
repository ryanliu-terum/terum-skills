import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import '../backend/test-setup';

// Testing Library's 1000 ms default is too tight for the navigation-heavy screens on a loaded CI
// runner: a hash route change has to land, the router has to re-render and the screen's queries have
// to resolve. The whole suite passes locally and in isolation; only the shared GitHub runner loses
// the race, and it picks a different test each run. Give the async utilities real headroom, and give
// vitest enough test timeout that a slow waitFor reports its own assertion instead of being cut off.
configure({ asyncUtilTimeout: 3000 });
