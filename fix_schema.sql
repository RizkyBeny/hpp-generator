-- Jalankan script ini di SQL Editor Supabase untuk memperbaiki nama kolom
ALTER TABLE IF EXISTS transactions 
RENAME COLUMN trx_number TO receipt_number;
