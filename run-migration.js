const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, 'migrations', '20260302_add_test_series.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration: 20260302_add_test_series.sql');
    
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
    
    console.log('Migration completed successfully!');
    console.log('Created tables:');
    console.log('  - test_series');
    console.log('  - test_series_sections');
    console.log('  - test_series_topics');
    console.log('Added columns to exams table:');
    console.log('  - is_test_series');
    console.log('  - test_series_id');
    console.log('  - test_series_section_id');
    console.log('  - test_series_topic_id');
    console.log('  - exam_date');
    console.log('  - display_order');
    
  } catch (error) {
    console.error('Error running migration:', error);
    process.exit(1);
  }
}

runMigration();
