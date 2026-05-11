package com.biou.shopifyhub.asset.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.biou.shopifyhub.asset.entity.AssetSnapshotEntry;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Mapper
public interface AssetSnapshotEntryMapper extends BaseMapper<AssetSnapshotEntry> {

    /** 按 category 聚合 count，前端 tab 上的徽章用。 */
    @Select("SELECT category AS category, COUNT(*) AS cnt "
        + "FROM asset_snapshot_entry "
        + "WHERE snapshot_id = #{snapshotId} "
        + "GROUP BY category")
    List<Map<String, Object>> countByCategoryRaw(@Param("snapshotId") Long snapshotId);

    /** 包装一层把 Map List 转 {category → count}。 */
    default Map<String, Long> countByCategory(Long snapshotId) {
        Map<String, Long> out = new HashMap<>();
        for (Map<String, Object> row : countByCategoryRaw(snapshotId)) {
            Object c = row.get("category");
            Object n = row.get("cnt");
            if (c != null && n instanceof Number num) {
                out.put(c.toString(), num.longValue());
            }
        }
        return out;
    }
}
