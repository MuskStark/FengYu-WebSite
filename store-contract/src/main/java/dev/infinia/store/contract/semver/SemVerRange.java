package dev.infinia.store.contract.semver;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * SemVer range expressions with npm-compatible semantics:
 *
 * <ul>
 *   <li>exact {@code 1.2.3}, partial/wildcard {@code 1.x}, {@code 1.2.*}, {@code *}</li>
 *   <li>comparators {@code =}, {@code &gt;}, {@code &gt;=}, {@code &lt;}, {@code &lt;=}</li>
 *   <li>{@code ~1.2.3} and {@code ^1.2.3} shorthands (with 0.x zero-caret rules)</li>
 *   <li>hyphen ranges {@code 1.2.3 - 2.0.0}</li>
 *   <li>space = AND, {@code ||} = OR</li>
 *   <li>prerelease versions match by plain comparator ordering — the FengYu host's
 *       {@code SemanticVersionRange} deliberately does not replicate npm's
 *       prerelease-membership rule ("a prerelease inside the expanded window
 *       matches"), and the store resolves on the host's behalf</li>
 * </ul>
 *
 * This matches the FengYu host {@code SemanticVersionRange} semantics referenced by the
 * design (§9.4), clean-room implemented so the contract module stays dependency-free.
 */
public final class SemVerRange {

    /** A single primitive comparator. {@code op == null} means "any version". */
    private static class ComparatorNode {
        final String op;
        final SemVer version;

        ComparatorNode(String op, SemVer version) {
            this.op = op;
            this.version = version;
        }

        boolean matches(SemVer v) {
            if (op == null) {
                return true;
            }
            int c = v.compareTo(version);
            return switch (op) {
                case "=", "==" -> c == 0;
                case ">" -> c > 0;
                case ">=" -> c >= 0;
                case "<" -> c < 0;
                case "<=" -> c <= 0;
                default -> false;
            };
        }
    }

    private final List<List<ComparatorNode>> orSets;
    private final String source;

    private SemVerRange(String source, List<List<ComparatorNode>> orSets) {
        this.source = source;
        this.orSets = orSets;
    }

    public static SemVerRange parse(String input) {
        Objects.requireNonNull(input, "range must not be null");
        String src = input.trim();
        if (src.isEmpty()) {
            throw new IllegalArgumentException("Empty version range");
        }
        List<List<ComparatorNode>> orSets = new ArrayList<>();
        for (String orPart : src.split("\\|\\|")) {
            List<ComparatorNode> set = parseAndSet(orPart.trim());
            if (set.isEmpty()) {
                throw new IllegalArgumentException("Invalid version range: " + input);
            }
            orSets.add(set);
        }
        return new SemVerRange(src, orSets);
    }

    private static List<ComparatorNode> parseAndSet(String andSource) {
        if (andSource.isEmpty()) {
            throw new IllegalArgumentException("Empty comparator set in range");
        }
        // Hyphen range has spaces around the dash but no comparator operators.
        List<ComparatorNode> nodes = new ArrayList<>();
        java.util.regex.Matcher hyphen =
                java.util.regex.Pattern.compile("\\s+-\\s+").matcher(andSource);
        if (hyphen.find()) {
            String lower = andSource.substring(0, hyphen.start()).trim();
            String upper = andSource.substring(hyphen.end()).trim();
            nodes.add(partialToComparator(">=", lower));
            if (!upper.isEmpty() && !isWildcard(upper)) {
                // "1.2 - 2.3" means <= 2.3 (inclusive on the patch given), "1.2 - 2" means < 3.0.0
                String[] parts = upper.split("\\.");
                if (parts.length == 1) {
                    nodes.add(partialToComparator("<", raiseCore(parts[0], null, null)));
                } else if (parts.length == 2) {
                    nodes.add(partialToComparator("<", raiseCore(parts[0], parts[1], null)));
                } else {
                    nodes.add(partialToComparator("<=", upper));
                }
            }
            return nodes;
        }
        for (String token : andSource.split("\\s+")) {
            nodes.add(parseComparator(token));
        }
        return nodes;
    }

    private static String raiseCore(String major, String minor, String patch) {
        long mj = Long.parseLong(major.replaceFirst("^(\\d+).*$", "$1"));
        if (minor == null) {
            return (mj + 1) + ".0.0";
        }
        long mn = Long.parseLong(minor.replaceFirst("^(\\d+).*$", "$1"));
        if (patch == null) {
            return mj + "." + (mn + 1) + ".0";
        }
        throw new IllegalArgumentException("raiseCore does not accept patch");
    }

    private static ComparatorNode parseComparator(String token) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile(
                "^(>=|<=|==|=|>|<|~|\\^)?(.+)$").matcher(token);
        if (!m.matches()) {
            throw new IllegalArgumentException("Invalid comparator: " + token);
        }
        String op = m.group(1);
        String verStr = m.group(2).trim();
        if (op == null) {
            if (verStr.isEmpty() || verStr.equals("*") || verStr.equals("x") || verStr.equals("X")) {
                return new ComparatorNode(null, null);
            }
            // Partial / wildcard versions without operator:
            //   1     -> >=1.0.0  <2.0.0
            //   1.2   -> >=1.2.0  <1.3.0
            //   1.x   -> >=1.0.0  <2.0.0
            //   1.2.x -> >=1.2.0  <1.3.0
            String[] parts = verStr.split("\\.");
            int wildcardAt = -1;
            for (int i = 0; i < parts.length; i++) {
                if (parts[i].equals("*") || parts[i].equals("x") || parts[i].equals("X")) {
                    wildcardAt = i;
                    break;
                }
            }
            boolean partial = parts.length <= 2 || wildcardAt >= 0;
            if (partial && !verStr.contains("-") && !verStr.contains("+")) {
                try {
                    long mj = Long.parseLong(parts[0]);
                    String lower = mj + ".0.0";
                    String upper = (mj + 1) + ".0.0";
                    boolean hasMinor = parts.length >= 2 && (wildcardAt == -1 || wildcardAt >= 2);
                    if (hasMinor) {
                        long mn = Long.parseLong(parts[1]);
                        lower = mj + "." + mn + ".0";
                        upper = mj + "." + (mn + 1) + ".0";
                    }
                    return and(new ComparatorNode(">=", SemVer.parse(lower)),
                            new ComparatorNode("<", SemVer.parse(upper)));
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("Invalid comparator: " + token);
                }
            }
            return new ComparatorNode("=", SemVer.parse(verStr));
        }
        if (op.equals("~")) {
            return tilde(verStr);
        }
        if (op.equals("^")) {
            return caret(verStr);
        }
        if (isWildcard(verStr)) {
            if (op.equals(">=") || op.equals("=")) {
                return new ComparatorNode(null, null);
            }
            throw new IllegalArgumentException("Wildcard not allowed with operator " + op);
        }
        String[] parts = verStr.split("\\.");
        // Allow ">=4" / ">=4.1" partials: promote zeros.
        if (parts.length < 3 && !verStr.contains("-")) {
            try {
                if (parts.length == 1) {
                    verStr = parts[0] + ".0.0";
                } else {
                    verStr = parts[0] + "." + parts[1] + ".0";
                }
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        return new ComparatorNode(op, SemVer.parse(verStr));
    }

    private static ComparatorNode tilde(String verStr) {
        String[] parts = verStr.split("\\.");
        if (parts.length == 1) {
            SemVer v = SemVer.parse(parts[0] + ".0.0");
            return and(new ComparatorNode(">=", v), new ComparatorNode("<",
                    SemVer.parse((v.major + 1) + ".0.0")));
        }
        if (parts.length == 2) {
            SemVer v = SemVer.parse(parts[0] + "." + parts[1] + ".0");
            return and(new ComparatorNode(">=", v), new ComparatorNode("<",
                    SemVer.parse(v.major + "." + (v.minor + 1) + ".0")));
        }
        SemVer v = SemVer.parse(verStr);
        return and(new ComparatorNode(">=", v), new ComparatorNode("<",
                SemVer.parse(v.major + "." + (v.minor + 1) + ".0")));
    }

    private static ComparatorNode caret(String verStr) {
        String[] parts = verStr.split("\\.");
        SemVer v = parts.length == 1
                ? SemVer.parse(parts[0] + ".0.0")
                : parts.length == 2
                        ? SemVer.parse(parts[0] + "." + parts[1] + ".0")
                        : SemVer.parse(verStr);
        String upper;
        if (v.major > 0) {
            upper = (v.major + 1) + ".0.0";
        } else if (v.minor > 0) {
            upper = "0." + (v.minor + 1) + ".0";
        } else {
            upper = "0.0." + (v.patch + 1);
        }
        return and(new ComparatorNode(">=", v), new ComparatorNode("<", SemVer.parse(upper)));
    }

    private static ComparatorNode partialToComparator(String op, String partial) {
        if (isWildcard(partial)) {
            return new ComparatorNode(null, null);
        }
        String[] parts = partial.split("\\.");
        String full = switch (parts.length) {
            case 1 -> parts[0] + ".0.0";
            case 2 -> parts[0] + "." + parts[1] + ".0";
            default -> partial;
        };
        return new ComparatorNode(op, SemVer.parse(full));
    }

    private static boolean isWildcard(String s) {
        if (s.isEmpty() || s.equals("*") || s.equals("x") || s.equals("X")) {
            return true;
        }
        for (String part : s.split("\\.")) {
            if (part.equals("*") || part.equals("x") || part.equals("X")) {
                return true;
            }
        }
        return false;
    }

    /** Pseudo-node joining two nodes; implemented by returning a merged marker set element. */
    private static ComparatorNode and(ComparatorNode a, ComparatorNode b) {
        return new AndNode(a, b);
    }

    private static final class AndNode extends ComparatorNode {
        final ComparatorNode left;
        final ComparatorNode right;

        AndNode(ComparatorNode left, ComparatorNode right) {
            super(null, null);
            this.left = left;
            this.right = right;
        }

        @Override
        boolean matches(SemVer v) {
            return left.matches(v) && right.matches(v);
        }
    }

    public boolean matches(SemVer version) {
        // Plain comparator ordering only — deliberately NOT npm's prerelease
        // membership rule. The store resolves on behalf of the FengYu host, whose
        // SemanticVersionRange matches any prerelease inside the comparator window;
        // gating here would make the store refuse plugins the host itself accepts
        // (e.g. host 4.1.0-beta.1 against engines ">=4.0.0-rc.2 <5.0.0").
        for (List<ComparatorNode> set : orSets) {
            boolean all = true;
            for (ComparatorNode node : set) {
                if (!node.matches(version)) {
                    all = false;
                    break;
                }
            }
            if (all) {
                return true;
            }
        }
        return false;
    }

    /** True when the range accepts any version at all (e.g. {@code *}). */
    public boolean isAny() {
        return orSets.size() == 1 && orSets.get(0).size() == 1 && orSets.get(0).get(0).op == null
                && !(orSets.get(0).get(0) instanceof AndNode);
    }

    @Override
    public String toString() {
        return source;
    }
}
