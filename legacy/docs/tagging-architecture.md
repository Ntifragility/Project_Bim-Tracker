# Batch Tagging Architecture

## Purpose

Assign deterministic, type-aware element tags to ordered IFC selections while
preserving tray-system grouping, existing source values, and non-destructive IFC
export.

## Tag contract

The default scheme uses `{prefix}{system}.{type}.{sequence}`:

```text
SystemTag:  PT1
ElementTag: PT1.01.01
```

Type `01` represents cable trays and type `02` represents cable fittings by
default. Both codes, the sequence start, and the sequence width are configurable.
Sequences are independent by system and type. New assignments append after the
highest reserved sequence instead of reusing gaps.

## Data flow

```text
Viewer highlight
  -> ordered selection keys
  -> element identities
  -> explicit kind or conservative classifier
  -> tag-scheme allocator
  -> conflict-aware preview
  -> pending assignment map
  -> integrity validation
  -> IFC and Excel exporters
```

`src/tagging/tag-scheme.js` is a viewer-independent domain module. It owns scheme
normalization, validation, formatting, parsing, and allocation.

`src/tagging/element-classifier.js` recognizes standard IFC cable-carrier classes
and conservative metadata terms. Ambiguous elements return no classification and
must be assigned explicitly by the user.

The viewer keeps saved IFC assignments separate from pending edits. Effective
assignments overlay pending values on saved values, excluding pending deletions.
The batch undo operation snapshots only keys touched by the latest batch.

## IFC persistence

The exporter writes structured values to `CCP_TRAY_SYSTEM` and writes the final
element tag to the native `IfcElement.Tag` position for a limited allowlist of
supported cable/distribution element entity types. Unsupported entity types still
receive the custom property set and are reported through the export result.

The source IFC remains unchanged. Each export creates a new `_tagged.ifc` file.

## Excel persistence

The Tag Register sheet is generated from effective assignments, not only pending
changes. This ensures a re-exported workbook represents the complete currently
loaded tagging state. The Summary sheet aggregates counts by system, kind, model,
and source state.

## Compatibility

Legacy assignments whose component IDs use `SystemTag-C001` remain readable.
Pattern-version 2 assignments store the final tag in both `ElementTag` and
`ComponentId`, allowing the existing component navigation and uniqueness
validation paths to continue working.
