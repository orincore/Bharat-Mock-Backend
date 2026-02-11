-- Allow new block types (adBanner, examCards) in page_content_blocks
ALTER TABLE page_content_blocks
  DROP CONSTRAINT IF EXISTS page_content_blocks_block_type_check;

ALTER TABLE page_content_blocks
  ADD CONSTRAINT page_content_blocks_block_type_check
  CHECK (
    block_type IN (
      'heading',
      'paragraph',
      'list',
      'table',
      'image',
      'chart',
      'quote',
      'code',
      'divider',
      'button',
      'accordion',
      'tabs',
      'card',
      'alert',
      'video',
      'embed',
      'html',
      'columns',
      'spacer',
      'adBanner',
      'examCards'
    )
  );
