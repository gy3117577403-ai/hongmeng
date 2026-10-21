# Knowledge Office fixtures

These are generated test documents, containing only synthetic acceptance text.
- XLS and XLSX: SheetJS workbook with three columns and one sample purchasing item.
- DOCX: a minimal OOXML Word document with a Chinese acceptance sentence.
- DOC: the same DOCX converted by LibreOffice using the `MS Word 97` export filter.

The files verify legacy and modern formats, MIME normalization, S3 round-trip bytes,
and that unrelated upload endpoints retain their existing format restrictions.
