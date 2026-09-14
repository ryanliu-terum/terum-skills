"""AQ2 · follow-up to AQ: the three Settings boards that name their section by label ("Teams", "Sharing") must use the
relabelled keys ("Team", "Publishing") or settings_nav draws no selected row. Run: python3 .patches/patch_aq2.py"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from patchlib import Patch
p = Patch("AQ2")
p.rep('"SettingsTeams":      lambda: settings_page(theme("dark"), "Teams",', '"SettingsTeams":      lambda: settings_page(theme("dark"), "Team",')
p.rep('"SettingsSharing":    lambda: settings_page(theme("dark"), "Sharing",', '"SettingsSharing":    lambda: settings_page(theme("dark"), "Publishing",')
p.rep('"SettingsLeave":      lambda: settings_page(theme("dark"), "Teams",', '"SettingsLeave":      lambda: settings_page(theme("dark"), "Team",')
p.write()
