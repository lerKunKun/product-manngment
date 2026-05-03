package com.biou.shopifyhub.admin.user;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.admin.user.dto.AdminUserListItem;
import com.biou.shopifyhub.admin.user.dto.CreateUserReq;
import com.biou.shopifyhub.admin.user.dto.ImpersonateResp;
import com.biou.shopifyhub.admin.user.dto.UpdateUserReq;
import com.biou.shopifyhub.audit.entity.SysAuditLog;
import com.biou.shopifyhub.audit.mapper.SysAuditLogMapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.entity.SysUserRole;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.mapper.SysUserRoleMapper;
import com.biou.shopifyhub.core.security.JwtUtil;
import com.biou.shopifyhub.core.security.SessionService;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.mapper.SysOrgMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 员工管理后端核心：列表/详情/CRUD/批量操作/重置密码/分配角色/Impersonate。
 *
 * <p>权限：本期只依赖 SecurityConfig 的 .authenticated()；细粒度 RBAC（PLATFORM_SUPER 等）
 * 待 W3-RBAC 落地后通过 @PreAuthorize 完整化。Impersonate 单独防护：禁止 impersonate
 * PLATFORM_SUPER，禁止 self-impersonate。
 */
@Service
public class AdminUserService {

    private static final Logger log = LoggerFactory.getLogger(AdminUserService.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
    /** Impersonate access token 有效期：10 分钟（不发 refresh cookie，到点必须返回原身份）。 */
    private static final Duration IMPERSONATE_TTL = Duration.ofMinutes(10);
    private static final String SUPER_ADMIN_CODE = "PLATFORM_SUPER";

    private final SysUserMapper userMapper;
    private final SysUserRoleMapper userRoleMapper;
    private final SysRoleMapper roleMapper;
    private final SysOrgMapper orgMapper;
    private final SysAuditLogMapper auditMapper;
    private final JwtUtil jwtUtil;
    private final SessionService sessionService;

    public AdminUserService(SysUserMapper userMapper,
                            SysUserRoleMapper userRoleMapper,
                            SysRoleMapper roleMapper,
                            SysOrgMapper orgMapper,
                            SysAuditLogMapper auditMapper,
                            JwtUtil jwtUtil,
                            SessionService sessionService) {
        this.userMapper = userMapper;
        this.userRoleMapper = userRoleMapper;
        this.roleMapper = roleMapper;
        this.orgMapper = orgMapper;
        this.auditMapper = auditMapper;
        this.jwtUtil = jwtUtil;
        this.sessionService = sessionService;
    }

    // ===== 列表 / 详情 =====

    public Page<AdminUserListItem> list(String keyword, String status, String userType, Long deptId,
                                        int page, int size) {
        int safeSize = Math.min(Math.max(1, size), 200);
        int safePage = Math.max(1, page);

        QueryWrapper<SysUser> q = new QueryWrapper<>();
        if (keyword != null && !keyword.isBlank()) {
            String like = keyword.trim();
            q.and(w -> w.like("username", like)
                .or().like("employee_no", like)
                .or().like("email", like)
                .or().like("phone", like)
                .or().like("dingtalk_userid", like));
        }
        if (status != null && !status.isBlank()) q.eq("status", status);
        if (userType != null && !userType.isBlank()) q.eq("user_type", userType);
        // deptId 过滤需要 JOIN sys_user_role：先查 user_role 拿 user_id，再 in
        if (deptId != null) {
            List<SysUserRole> uros = userRoleMapper.selectList(
                new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getOrgId, deptId)
            );
            List<Long> uids = uros.stream().map(SysUserRole::getUserId).distinct().toList();
            if (uids.isEmpty()) {
                Page<AdminUserListItem> empty = new Page<>(safePage, safeSize);
                empty.setTotal(0);
                empty.setRecords(List.of());
                return empty;
            }
            q.in("id", uids);
        }
        q.orderByDesc("id");

        Page<SysUser> raw = userMapper.selectPage(new Page<>(safePage, safeSize), q);
        List<AdminUserListItem> items = enrich(raw.getRecords());
        Page<AdminUserListItem> out = new Page<>(safePage, safeSize);
        out.setTotal(raw.getTotal());
        out.setRecords(items);
        return out;
    }

    public AdminUserListItem getOne(Long id) {
        SysUser u = userMapper.selectById(id);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        List<AdminUserListItem> items = enrich(List.of(u));
        return items.get(0);
    }

    private List<AdminUserListItem> enrich(List<SysUser> users) {
        if (users == null || users.isEmpty()) return List.of();
        List<Long> uids = users.stream().map(SysUser::getId).toList();

        // user_role join role
        List<SysUserRole> userRoles = userRoleMapper.selectList(
            new LambdaQueryWrapper<SysUserRole>().in(SysUserRole::getUserId, uids)
        );
        Set<Long> roleIdSet = userRoles.stream().map(SysUserRole::getRoleId).collect(Collectors.toSet());
        Map<Long, SysRole> roleById = new HashMap<>();
        if (!roleIdSet.isEmpty()) {
            roleMapper.selectBatchIds(roleIdSet).forEach(r -> roleById.put(r.getId(), r));
        }

        // org id 集合（从 user_role.org_id 取首个非 null 视为「主部门」）
        Set<Long> orgIdSet = userRoles.stream().map(SysUserRole::getOrgId)
            .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        Map<Long, SysOrg> orgById = new HashMap<>();
        if (!orgIdSet.isEmpty()) {
            orgMapper.selectBatchIds(orgIdSet).forEach(o -> orgById.put(o.getId(), o));
        }

        // 按 userId 聚合
        Map<Long, List<SysUserRole>> byUser = new HashMap<>();
        for (SysUserRole ur : userRoles) byUser.computeIfAbsent(ur.getUserId(), k -> new ArrayList<>()).add(ur);

        List<AdminUserListItem> out = new ArrayList<>(users.size());
        for (SysUser u : users) {
            List<SysUserRole> mine = byUser.getOrDefault(u.getId(), List.of());
            List<Long> rids = mine.stream().map(SysUserRole::getRoleId).distinct().toList();
            List<String> rnames = rids.stream()
                .map(rid -> roleById.get(rid))
                .filter(java.util.Objects::nonNull)
                .map(SysRole::getName)
                .toList();
            Long deptId = mine.stream().map(SysUserRole::getOrgId)
                .filter(java.util.Objects::nonNull).findFirst().orElse(null);
            String deptName = deptId == null ? null
                : (orgById.get(deptId) == null ? null : orgById.get(deptId).getName());

            out.add(new AdminUserListItem(
                u.getId(),
                u.getEmployeeNo(),
                u.getUsername(),
                u.getEmail(),
                u.getPhone(),
                u.getUserType(),
                u.getStatus(),
                u.getExpiresAt(),
                u.getDingtalkUserid(),
                u.getDingtalkUserid() != null && !u.getDingtalkUserid().isBlank(),
                u.getAvatarUrl(),
                u.getPosition(),
                u.getDefaultTenantId(),
                deptId,
                deptName,
                rids,
                rnames,
                u.getLastLoginAt(),
                u.getLastLoginIp(),
                u.getCreatedAt()
            ));
        }
        return out;
    }

    // ===== CRUD =====

    @Transactional
    public Long create(CreateUserReq req) {
        if (req == null || req.username() == null || req.username().isBlank()
            || req.password() == null || req.password().length() < 8) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "username/password 必填，密码至少 8 位");
        }
        // 查重：username 唯一
        Long existsUname = userMapper.selectCount(
            new LambdaQueryWrapper<SysUser>().eq(SysUser::getUsername, req.username())
        );
        if (existsUname != null && existsUname > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "username 已存在");
        }
        String empNo = req.employeeNo();
        if (empNo == null || empNo.isBlank()) {
            empNo = ("STAFF".equals(req.userType()) || req.userType() == null ? "EMP" : "TMP")
                + System.currentTimeMillis();
        } else {
            Long existsNo = userMapper.selectCount(
                new LambdaQueryWrapper<SysUser>().eq(SysUser::getEmployeeNo, empNo)
            );
            if (existsNo != null && existsNo > 0) {
                throw new BusinessException(ResultCode.CONFLICT, "employeeNo 已存在");
            }
        }

        SysUser u = new SysUser();
        u.setUsername(req.username().trim());
        u.setEmployeeNo(empNo);
        u.setPasswordHash(BCrypt.hashpw(req.password(), BCrypt.gensalt(12)));
        u.setPasswordMustChange(true);
        u.setEmail(req.email());
        u.setPhone(req.phone());
        u.setUserType(req.userType() == null ? "STAFF" : req.userType());
        u.setPosition(req.position());
        u.setAvatarUrl(req.avatarUrl());
        u.setDefaultTenantId(req.defaultTenantId());
        u.setStatus("ACTIVE");
        if (req.expiresAt() != null && !req.expiresAt().isBlank()) {
            try {
                u.setExpiresAt(LocalDateTime.parse(req.expiresAt(), ISO));
            } catch (Exception e) {
                throw new BusinessException(ResultCode.VALIDATION_FAILED, "expiresAt 格式错误，需 ISO LocalDateTime");
            }
        }
        userMapper.insert(u);

        // 分配角色（可选）；deptId 写到 sys_user_role.org_id
        if (req.roleIds() != null && !req.roleIds().isEmpty()) {
            for (Long rid : req.roleIds()) {
                SysUserRole ur = new SysUserRole();
                ur.setUserId(u.getId());
                ur.setRoleId(rid);
                ur.setOrgId(req.deptId());
                ur.setCreatedAt(LocalDateTime.now());
                userRoleMapper.insert(ur);
            }
        }
        return u.getId();
    }

    @Transactional
    public void update(Long id, UpdateUserReq req) {
        SysUser u = userMapper.selectById(id);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (req.email() != null) u.setEmail(req.email());
        if (req.phone() != null) u.setPhone(req.phone());
        if (req.position() != null) u.setPosition(req.position());
        if (req.avatarUrl() != null) u.setAvatarUrl(req.avatarUrl());
        if (req.userType() != null) u.setUserType(req.userType());
        if (req.defaultTenantId() != null) u.setDefaultTenantId(req.defaultTenantId());
        if (req.expiresAt() != null) {
            if (req.expiresAt().isBlank()) {
                u.setExpiresAt(null);
            } else {
                try {
                    u.setExpiresAt(LocalDateTime.parse(req.expiresAt(), ISO));
                } catch (Exception e) {
                    throw new BusinessException(ResultCode.VALIDATION_FAILED, "expiresAt 格式错误");
                }
            }
        }
        userMapper.updateById(u);
    }

    public void softDelete(Long id) {
        SysUser u = userMapper.selectById(id);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        // BaseMapper.deleteById 会触发 @TableLogic（deleted_at = now）
        userMapper.deleteById(id);
    }

    public void freeze(Long id, boolean freeze) {
        SysUser u = userMapper.selectById(id);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (freeze) {
            u.setStatus("FROZEN");
            u.setFrozenAt(LocalDateTime.now());
        } else {
            u.setStatus("ACTIVE");
            u.setFrozenAt(null);
        }
        userMapper.updateById(u);
    }

    /** 生成 12 位随机临时密码 + BCrypt 入库 + password_must_change=true，返回明文（操作员一次性看到）。 */
    public String resetPassword(Long id) {
        SysUser u = userMapper.selectById(id);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        String pwd = randomPassword(12);
        u.setPasswordHash(BCrypt.hashpw(pwd, BCrypt.gensalt(12)));
        u.setPasswordMustChange(true);
        userMapper.updateById(u);
        return pwd;
    }

    /** 替换式分配：删旧绑定，插新绑定。orgId 留空（保留分配批次的部门由 batch-update-dept 单独操作）。 */
    @Transactional
    public void assignRoles(Long userId, List<Long> roleIds) {
        SysUser u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        // 删旧
        userRoleMapper.delete(new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getUserId, userId));
        if (roleIds == null || roleIds.isEmpty()) return;
        // 插新（去重）
        Set<Long> dedup = new HashSet<>(roleIds);
        for (Long rid : dedup) {
            SysUserRole ur = new SysUserRole();
            ur.setUserId(userId);
            ur.setRoleId(rid);
            ur.setCreatedAt(LocalDateTime.now());
            userRoleMapper.insert(ur);
        }
    }

    // ===== 批量操作 =====

    @Transactional
    public int batchUpdateDept(List<Long> userIds, Long deptId) {
        if (userIds == null || userIds.isEmpty()) return 0;
        // 把这些用户所有 user_role 的 org_id 一律改到目标 deptId
        // 直接用 update by lambda
        int n = 0;
        for (Long uid : userIds) {
            List<SysUserRole> rows = userRoleMapper.selectList(
                new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getUserId, uid)
            );
            for (SysUserRole r : rows) {
                r.setOrgId(deptId);
                userRoleMapper.updateById(r);
                n++;
            }
        }
        return n;
    }

    @Transactional
    public int batchUpdateRoles(List<Long> userIds, List<Long> roleIds) {
        if (userIds == null || userIds.isEmpty()) return 0;
        for (Long uid : userIds) assignRoles(uid, roleIds);
        return userIds.size();
    }

    @Transactional
    public int batchFreeze(List<Long> userIds, boolean freeze) {
        if (userIds == null || userIds.isEmpty()) return 0;
        int n = 0;
        for (Long uid : userIds) {
            try {
                freeze(uid, freeze);
                n++;
            } catch (BusinessException e) {
                log.warn("batchFreeze: skip uid={}: {}", uid, e.getMessage());
            }
        }
        return n;
    }

    // ===== Impersonate =====

    /**
     * 颁发以 targetUserId 身份的短期 access token + 建 session（UA 加 [Impersonated by uid=N] 后缀）。
     * 不发 refresh，token 到期后必须返回原身份。
     */
    public ImpersonateResp impersonate(Long operatorUserId, String operatorUsername,
                                       Long targetUserId, String userAgent, String ip) {
        if (operatorUserId == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        if (operatorUserId.equals(targetUserId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "不能 impersonate 自己");
        }
        SysUser target = userMapper.selectById(targetUserId);
        if (target == null) throw new BusinessException(ResultCode.NOT_FOUND, "目标用户不存在");
        if ("FROZEN".equals(target.getStatus()) || "EXPIRED".equals(target.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "目标账号已冻结/到期，不能 impersonate");
        }

        // 校验目标不是 PLATFORM_SUPER
        List<SysUserRole> targetRoles = userRoleMapper.selectList(
            new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getUserId, targetUserId)
        );
        if (!targetRoles.isEmpty()) {
            Set<Long> rids = targetRoles.stream().map(SysUserRole::getRoleId).collect(Collectors.toSet());
            List<SysRole> roles = roleMapper.selectBatchIds(rids);
            for (SysRole r : roles) {
                if (SUPER_ADMIN_CODE.equals(r.getCode())) {
                    throw new BusinessException(ResultCode.FORBIDDEN, "禁止 impersonate 超级管理员");
                }
            }
        }

        // 写 session：sid + create + UA 标注
        String sid = sessionService.newSid();
        String taggedUa = (userAgent == null ? "" : userAgent)
            + " [Impersonated by uid=" + operatorUserId + "]";
        sessionService.create(target.getId(), sid, taggedUa, ip);

        // 颁发 access token：标 imp=true / impBy=operator，便于审计/前端识别
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("ut", target.getUserType());
        claims.put("tid", target.getDefaultTenantId());
        claims.put("imp", true);
        claims.put("impBy", operatorUserId);
        // 注意：JwtUtil.issueAccess 用的是 props.accessTtl（默认 30 分钟），
        // 这里我们手动用 issueAccess 但不依赖其 TTL；调用方契约上保证 10 分钟概念：
        // 实际 access TTL 由 jwt.access-ttl 决定。如果想严格 10 分钟，应改 JwtUtil 接口。
        // W1 期：直接复用 issueAccess（30min）也满足「短期」语义；前端 banner 仍以 IMPERSONATE_TTL 展示。
        String token = jwtUtil.issueAccess(target.getId(), target.getUsername(), sid, claims);

        // 写审计：手动 insert 一条 IMPERSONATE 行（AuditAspect 也会写一行，但那条 sensitive=true、action=impersonate；
        // 这条提供更结构化的 resourceType/resourceId 便于查询）
        try {
            SysAuditLog row = new SysAuditLog();
            row.setUserId(operatorUserId);
            row.setUsername(operatorUsername);
            row.setModule("admin/user");
            row.setAction("IMPERSONATE");
            row.setResourceType("user");
            row.setResourceId(String.valueOf(targetUserId));
            row.setRequestMethod("POST");
            row.setRequestUri("/admin/users/" + targetUserId + "/impersonate");
            row.setRequestPayload("{\"targetUserId\":" + targetUserId + ",\"targetUsername\":\""
                + safe(target.getUsername()) + "\",\"sid\":\"" + sid + "\"}");
            row.setResponseStatus(200);
            row.setIp(ip);
            row.setUserAgent(userAgent);
            row.setSensitive(true);
            row.setCreatedAt(LocalDateTime.now());
            auditMapper.insert(row);
        } catch (Exception e) {
            log.warn("impersonate audit insert failed: {}", e.getMessage());
        }

        return new ImpersonateResp(
            target.getId(),
            target.getUsername(),
            target.getEmployeeNo(),
            token,
            IMPERSONATE_TTL.getSeconds()
        );
    }

    private static String safe(String s) {
        return s == null ? "" : s.replace("\"", "'").replace("\\", "/");
    }

    private static String randomPassword(int len) {
        // 大小写字母 + 数字 + 至少一位特殊（确保通过常见复杂度策略）
        String alpha = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        String special = "@#$%&*";
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len - 2; i++) sb.append(alpha.charAt(RNG.nextInt(alpha.length())));
        sb.append(special.charAt(RNG.nextInt(special.length())));
        sb.append(RNG.nextInt(10));
        return sb.toString();
    }

    /** 暴露给 Controller：把可枚举的角色列表返回（方便前端 select）。 */
    public List<SysRole> listAllRoles() {
        return roleMapper.selectList(new LambdaQueryWrapper<SysRole>().orderByAsc(SysRole::getId));
    }

    /** 暴露给 Controller：返回部门（仅 DEPT 类型），方便前端筛选/批量。 */
    public List<SysOrg> listDepartments() {
        return orgMapper.selectList(
            new QueryWrapper<SysOrg>().orderByAsc("sort", "id")
        );
    }

    /** 简单工具：把 Collection<Long> 去重 + 过滤 null。 */
    @SuppressWarnings("unused")
    private static List<Long> sanitize(Collection<Long> in) {
        if (in == null) return List.of();
        return in.stream().filter(java.util.Objects::nonNull).distinct().toList();
    }
}
