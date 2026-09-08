import { create } from 'zustand';
// Owned by this family because the shared app store is reserved by S1b-1.
// Persistence is routed through Backend.prefs by the flow, preserving the I/O seam.
interface OnboardingState {onboardingSkipped:string[];setSkipped:(steps:string[])=>void}
export const useOnboardingStore=create<OnboardingState>()(set=>({onboardingSkipped:[],setSkipped:onboardingSkipped=>set({onboardingSkipped})}));
