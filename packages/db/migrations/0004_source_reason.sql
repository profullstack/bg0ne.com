-- Why there is no "before", when there is no "before".
--
-- The share page was telling every sourceless row that the original had been "too
-- large to keep". For rows written before originals were stored at all that is
-- simply false, and a page that invents a reason is worse than one that admits it
-- does not have the image: the false reason sends somebody looking for a size limit
-- that had nothing to do with it.
--
-- Null means stored, or means we genuinely do not know (every row that predates
-- this column). 'too_large' and 'absent' are only ever written going forward, so
-- the page can tell the truth in all three cases.
alter table shares add column source_omitted_reason text;

-- Everything already here predates originals being kept at all. Say so, rather
-- than leaving it indistinguishable from a future row whose reason we failed to
-- record.
update shares set source_omitted_reason = 'legacy' where source is null;
