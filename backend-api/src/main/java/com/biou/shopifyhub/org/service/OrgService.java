package com.biou.shopifyhub.org.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.mapper.SysOrgMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class OrgService {

    private final SysOrgMapper mapper;
    private final JdbcTemplate jdbc;

    public OrgService(SysOrgMapper mapper, JdbcTemplate jdbc) {
        this.mapper = mapper;
        this.jdbc = jdbc;
    }

    /** 列出所有节点（用于前端建树）。 */
    public List<SysOrg> listAll() {
        return mapper.selectList(new QueryWrapper<SysOrg>().orderByAsc("sort", "id"));
    }

    /** 树结构（map 形式：{node, children:[...]}），适合前端 antd Tree。
     *  含 userCount：本节点直接挂的去重 user 数（前端聚合"自己+子孙"得整树员工数）。 */
    public List<Map<String, Object>> tree() {
        List<SysOrg> all = listAll();
        // 一次 group by 拿每个 org_id 的去重 user 数
        Map<Long, Long> userCountByOrg = new HashMap<>();
        jdbc.query(
            "SELECT org_id, COUNT(DISTINCT user_id) AS cnt FROM sys_user_role "
                + "WHERE org_id IS NOT NULL GROUP BY org_id",
            rs -> { userCountByOrg.put(rs.getLong("org_id"), rs.getLong("cnt")); }
        );
        Map<Long, Map<String, Object>> nodeMap = new HashMap<>();
        for (SysOrg o : all) {
            Map<String, Object> n = new HashMap<>();
            n.put("id", o.getId());
            n.put("parentId", o.getParentId());
            n.put("type", o.getType());
            n.put("name", o.getName());
            n.put("code", o.getCode());
            n.put("tenantId", o.getTenantId());
            n.put("path", o.getPath());
            n.put("dingtalkDeptId", o.getDingtalkDeptId());
            n.put("status", o.getStatus());
            n.put("userCount", userCountByOrg.getOrDefault(o.getId(), 0L));
            n.put("children", new ArrayList<Map<String, Object>>());
            nodeMap.put(o.getId(), n);
        }
        List<Map<String, Object>> roots = new ArrayList<>();
        for (Map<String, Object> n : nodeMap.values()) {
            Long pid = (Long) n.get("parentId");
            if (pid == null) roots.add(n);
            else {
                Map<String, Object> p = nodeMap.get(pid);
                if (p != null) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> kids = (List<Map<String, Object>>) p.get("children");
                    kids.add(n);
                } else {
                    roots.add(n); // 父节点丢失，挂根
                }
            }
        }
        return roots;
    }

    @Transactional
    public Long create(SysOrg input) {
        validateUnique(input.getCode(), null);
        if (input.getStatus() == null) input.setStatus("ACTIVE");
        if (input.getSort() == null) input.setSort(0);
        // 物化路径
        if (input.getParentId() == null) {
            input.setPath("/");
            // 顶级 COMPANY 兜底租户：未指定 tenantId 时填平台默认 1。
            // 之前漏填会让 sys_org.tenant_id=NULL，钉钉同步 query wrapper .eq("tenant_id", null)
            // 永远命不中已存在记录 → 用户同步只跑 root，DEPT 重跑撞 unique key。
            if (input.getTenantId() == null) input.setTenantId(1L);
        } else {
            SysOrg parent = mapper.selectById(input.getParentId());
            if (parent == null) throw new BusinessException(ResultCode.NOT_FOUND, "父节点不存在");
            // 父节点 path 末尾形如 /1/3/，先 insert 拿 id 再 update path
            input.setPath(parent.getPath() + "?/"); // 占位，下面 update
            if (input.getTenantId() == null) input.setTenantId(parent.getTenantId());
        }
        mapper.insert(input);
        if (input.getParentId() != null) {
            SysOrg parent = mapper.selectById(input.getParentId());
            input.setPath(parent.getPath() + input.getId() + "/");
            mapper.updateById(input);
        } else {
            input.setPath("/" + input.getId() + "/");
            mapper.updateById(input);
        }
        return input.getId();
    }

    @Transactional
    public void update(Long id, SysOrg patch) {
        SysOrg cur = mapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (patch.getCode() != null && !patch.getCode().equals(cur.getCode())) {
            validateUnique(patch.getCode(), id);
            cur.setCode(patch.getCode());
        }
        if (patch.getName() != null) cur.setName(patch.getName());
        if (patch.getSort() != null) cur.setSort(patch.getSort());
        if (patch.getStatus() != null) cur.setStatus(patch.getStatus());
        if (patch.getDingtalkDeptId() != null) cur.setDingtalkDeptId(patch.getDingtalkDeptId());
        mapper.updateById(cur);
    }

    @Transactional
    public void softDelete(Long id) {
        SysOrg cur = mapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        // 检查有无活跃子节点
        Long childCount = mapper.selectCount(new QueryWrapper<SysOrg>().eq("parent_id", id));
        if (childCount > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "存在子节点，请先删除子节点");
        }
        mapper.deleteById(id);
    }

    private void validateUnique(String code, Long excludeId) {
        if (code == null || code.isBlank()) throw new BusinessException(ResultCode.VALIDATION_FAILED, "code 必填");
        QueryWrapper<SysOrg> q = new QueryWrapper<SysOrg>().eq("code", code);
        if (excludeId != null) q.ne("id", excludeId);
        if (mapper.selectCount(q) > 0) throw new BusinessException(ResultCode.CONFLICT, "code 已存在: " + code);
    }
}
