# GAMUT Roadmap

GAMUT develops stable research workflows through versioned releases. The
[GitHub Project](https://github.com/users/eharquin/projects/3) is the operational
view of issues and active work; this roadmap describes intended outcomes rather
than promising dates or complete feature lists.

## Release principles

- A release claims only workflows backed by requirements, independent
  mathematical fixtures, automated verification, and an acceptance record.
- Algebra definitions own their conventions and numerical policies.
- Common language, document, evaluation, interpretation, and visualization
  boundaries must remain usable by more than one algebra.
- Deferred work remains visible in GitHub issues and does not make an accepted
  workflow provisional.

## 0.1 — Stable VGA(2) workflow

Released as [MultiVector 0.1.0](docs/releases/0.1.0.md) on 2026-09-13.
Establish the first reusable release around vector geometric algebra in two
dimensions:

- stable expression, dependency, document, and persistence behavior;
- VGA(2) operations, rotors, lists, positioned vectors and bivectors;
- accessible viewport navigation and direct manipulation;
- versioned conventions, numerical policy, examples, and acceptance evidence;
- a documented installation, verification, and release process.

## 0.2 — Multi-algebra foundation

Released as [0.2.0](docs/releases/0.2.0.md) on 2026-11-10; its PGA(2)
acceptance is pending ([#192](https://github.com/eharquin/gamut/issues/192)).
Introduces the pieces that make the architecture not VGA-specific:

- a registered algebra-definition and capability boundary;
- PGA(2) with versioned projective conventions;
- points, ideal entities, lines, incidence, join/meet, and Euclidean motions;
- canonical documents that preserve algebra identity and configuration.

The PGA(2) research workflow is claimed once its acceptance record is
complete, planned for 0.3.

## 0.3 — Library and expression organization

Make documents easier to organize, find and teach with
([scope](docs/releases/0.3.0.md), [milestone](https://github.com/eharquin/gamut/milestone/4)):

- a library panel with personal graphs and shipped example scenes, in folders,
  exportable and importable as a `.zip`;
- expression folders, comment rows, and a setting that hides multivector values;
- coordinate tuples owned by the active algebra, as points in PGA(2);
- the first extractions out of `App.tsx`, so that new interface lands outside it;
- the completed PGA(2) foundation acceptance of 0.2.0.

## 0.7 — Broader research workflows

Expand according to research value and validation evidence. Candidate outcomes
include VGA/PGA 3D, conformal workflows, NoViz calculation, figure export, and
reproducible sharing beyond the scene links of 0.2. An algebra enters a release
only when its conventions, interpretation, numerical behavior, and examples are
independently verified.

## 1.0 — JOSS research release

The intended JOSS release must be feature-complete for its stated scope rather
than complete every long-term idea. Its minimum project-specific boundary is:

- stable VGA(2) and PGA(2) workflows;
- sustained public releases and development history;
- reproducible scientific case studies;
- demonstrated research use and external validation;
- documented comparison with related geometric algebra tools;
- complete user, contributor, convention, and verification documentation;
- an archival release suitable for a permanent DOI.

January 2027 is only the earliest potential eligibility window under the
current JOSS public-history criterion. Submission depends on evidence, release
stability, and the policies in force at that time.

