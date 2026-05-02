-- W2-PUSH-03 起改：图片支持 R2 key 引用，让 push 走 base64 attachment 路径
ALTER TABLE product_image
  ADD COLUMN r2_key VARCHAR(512) NULL DEFAULT NULL AFTER src;
CREATE INDEX idx_product_image_r2_key ON product_image (r2_key);
