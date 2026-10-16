package dev.infinia.store.contract.semver;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.junit.jupiter.api.Assertions.*;

class SemVerRangeTest {

    @ParameterizedTest(name = "[{index}] {1} {0} {2}")
    @CsvSource({
            // range, version, expected match
            "1.2.3, 1.2.3, true",
            "1.2.3, 1.2.4, false",
            "*, 0.0.1, true",
            "*, 99.99.99, true",
            "1.x, 1.0.0, true",
            "1.x, 1.9.9, true",
            "1.x, 2.0.0, false",
            "1.2.x, 1.2.9, true",
            "1.2.x, 1.3.0, false",
            "1, 1.5.0, true",
            "1, 2.0.0, false",
            "1.2, 1.2.5, true",
            "1.2, 1.3.0, false",
            ">=4.0.0-beta.5 <5.0.0, 4.0.0-beta.5, true",
            ">=4.0.0-beta.5 <5.0.0, 4.0.1, true",
            ">=4.0.0-beta.5 <5.0.0, 4.5.0, true",
            ">=4.0.0-beta.5 <5.0.0, 5.0.0, false",
            ">=4.0.0-beta.5 <5.0.0, 4.0.0-beta.4, false",
            ">=4.0.0-beta.5 <5.0.0, 4.0.0-beta.6, true",
            "^1.0.0, 1.0.0, true",
            "^1.2.3, 1.9.9, true",
            "^1.2.3, 2.0.0, false",
            "^1.2.3, 1.2.2, false",
            "^0.2.3, 0.2.9, true",
            "^0.2.3, 0.3.0, false",
            "^0.0.3, 0.0.3, true",
            "^0.0.3, 0.0.4, false",
            "~1.2.3, 1.2.9, true",
            "~1.2.3, 1.3.0, false",
            "~1.2, 1.2.5, true",
            "~1.2, 1.3.0, false",
            "1.2.3 - 2.3.4, 1.5.0, true",
            "1.2.3 - 2.3.4, 2.3.4, true",
            "1.2.3 - 2.3.4, 2.3.5, false",
            "1.2 - 2, 1.9.0, true",
            "1.2 - 2, 2.9.0, true",
            "1.2 - 2, 3.0.0, false",
            ">=1.0.0 <1.5.0 || >=2.0.0, 1.4.0, true",
            ">=1.0.0 <1.5.0 || >=2.0.0, 1.6.0, false",
            ">=1.0.0 <1.5.0 || >=2.0.0, 2.1.0, true",
    })
    void matchesNpmSemantics(String range, String version, boolean expected) {
        assertEquals(expected, SemVerRange.parse(range).matches(SemVer.parse(version)),
                () -> range + " vs " + version);
    }

    @Test
    void prereleaseInsideTheWindowMatchesPlainRange() {
        // Host semantics (FengYu SemanticVersionRange): no npm prerelease-membership
        // gate — any prerelease inside the comparator window matches, so the store's
        // resolution agrees with the host's own engine evaluation.
        assertTrue(SemVerRange.parse(">=4.0.0 <5.0.0").matches(SemVer.parse("4.1.0-alpha.1")));
        // a plain release in the same range matches
        assertTrue(SemVerRange.parse(">=4.0.0 <5.0.0").matches(SemVer.parse("4.1.0")));
        // ordering below the lower bound still refuses
        assertFalse(SemVerRange.parse(">=4.0.0-beta.5 <5.0.0").matches(SemVer.parse("4.0.0-beta.4")));
    }

    @Test
    void detectsAnyRange() {
        assertTrue(SemVerRange.parse("*").isAny());
        assertTrue(SemVerRange.parse("x").isAny());
        assertFalse(SemVerRange.parse("1.x").isAny());
        assertFalse(SemVerRange.parse(">=1.0.0").isAny());
    }

    @Test
    void rejectsGarbage() {
        assertThrows(IllegalArgumentException.class, () -> SemVerRange.parse("abc"));
        assertThrows(IllegalArgumentException.class, () -> SemVerRange.parse(""));
        assertThrows(Exception.class, () -> SemVerRange.parse(">= 1.0.0"));
    }
}
