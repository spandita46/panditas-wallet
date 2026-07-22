import type { FastifyInstance } from "fastify";
import {
  createCategorySchema,
  createCategoryRuleSchema,
  updateCategorySchema,
  updateCategoryRuleSchema,
  type Beneficiary,
  type CategoryDTO,
  type CategoryKind,
  type CategoryRuleDTO,
  type RuleConditionType,
  type RuleLogic,
} from "@panditas/shared";
import type { Category, CategoryRule, CategoryRuleCondition } from "@prisma/client";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";

function toCategoryDTO(c: Category & { defaultBeneficiaryUser: { name: string } | null }): CategoryDTO {
  return {
    id: c.id,
    name: c.name,
    group: c.group,
    kind: c.kind as CategoryKind,
    monthlyLimit: c.monthlyLimit === null ? null : Number(c.monthlyLimit),
    color: c.color,
    sortOrder: c.sortOrder,
    archived: c.archived,
    defaultBeneficiary: c.defaultBeneficiary as Beneficiary | null,
    defaultBeneficiaryUserId: c.defaultBeneficiaryUserId,
    defaultBeneficiaryName: c.defaultBeneficiaryUser?.name ?? null,
  };
}

const ruleInclude = {
  category: { select: { name: true } },
  conditions: { include: { matchAccount: { select: { name: true, label: true } } } },
  linkedAccount: { select: { name: true, label: true } },
  beneficiaryUser: { select: { name: true } },
} as const;

type RuleWithRelations = CategoryRule & {
  category: { name: string };
  conditions: (CategoryRuleCondition & { matchAccount: { name: string; label: string | null } | null })[];
  linkedAccount: { name: string; label: string | null } | null;
  beneficiaryUser: { name: string } | null;
};

function toRuleDTO(r: RuleWithRelations): CategoryRuleDTO {
  return {
    id: r.id,
    categoryId: r.categoryId,
    categoryName: r.category.name,
    logic: r.logic as RuleLogic,
    conditions: r.conditions.map((c) => ({
      id: c.id,
      type: c.type as RuleConditionType,
      matchAccountId: c.matchAccountId,
      matchAccountName: c.matchAccount ? (c.matchAccount.label ?? c.matchAccount.name) : null,
      pattern: c.pattern,
      minAmount: c.minAmount === null ? null : Number(c.minAmount),
      maxAmount: c.maxAmount === null ? null : Number(c.maxAmount),
    })),
    priority: r.priority,
    linkedAccountId: r.linkedAccountId,
    linkedAccountName: r.linkedAccount ? (r.linkedAccount.label ?? r.linkedAccount.name) : null,
    beneficiary: r.beneficiary as Beneficiary | null,
    beneficiaryUserId: r.beneficiaryUserId,
    beneficiaryName: r.beneficiaryUser?.name ?? null,
  };
}

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireRole("admin", "adult") }, async () => {
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { defaultBeneficiaryUser: { select: { name: true } } },
    });
    return categories.map(toCategoryDTO);
  });

  app.post("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const category = await prisma.category.create({
      data: {
        name: parsed.data.name,
        group: parsed.data.group ?? null,
        kind: parsed.data.kind,
        monthlyLimit: parsed.data.monthlyLimit ?? null,
        color: parsed.data.color ?? null,
      },
      include: { defaultBeneficiaryUser: { select: { name: true } } },
    });
    return reply.code(201).send(toCategoryDTO(category));
  });

  app.patch("/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCategorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Category not found" });
    const category = await prisma.category.update({
      where: { id },
      data: parsed.data,
      include: { defaultBeneficiaryUser: { select: { name: true } } },
    });
    return toCategoryDTO(category);
  });

  // Rules ---------------------------------------------------------------

  app.get("/rules", { preHandler: requireRole("admin", "adult") }, async () => {
    const rules = await prisma.categoryRule.findMany({
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      include: ruleInclude,
    });
    return rules.map(toRuleDTO);
  });

  app.post("/rules", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = createCategoryRuleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const rule = await prisma.categoryRule.create({
      data: {
        categoryId: parsed.data.categoryId,
        logic: parsed.data.logic,
        priority: parsed.data.priority,
        linkedAccountId: parsed.data.linkedAccountId ?? null,
        beneficiary: parsed.data.beneficiary ?? null,
        beneficiaryUserId: parsed.data.beneficiary === "family_member" ? (parsed.data.beneficiaryUserId ?? null) : null,
        conditions: {
          create: parsed.data.conditions.map((c) => ({
            type: c.type,
            matchAccountId: c.type === "account" ? (c.matchAccountId ?? null) : null,
            pattern: c.type === "payee_contains" || c.type === "description_regex" ? (c.pattern ?? null) : null,
            minAmount: c.type === "amount_range" ? (c.minAmount ?? null) : null,
            maxAmount: c.type === "amount_range" ? (c.maxAmount ?? null) : null,
          })),
        },
      },
      include: ruleInclude,
    });
    return reply.code(201).send(toRuleDTO(rule));
  });

  app.patch("/rules/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCategoryRuleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const existing = await prisma.categoryRule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Rule not found" });

    const { conditions, beneficiary, ...rest } = parsed.data;
    const rule = await prisma.categoryRule.update({
      where: { id },
      data: {
        ...rest,
        ...(beneficiary !== undefined && {
          beneficiary,
          beneficiaryUserId: beneficiary === "family_member" ? (parsed.data.beneficiaryUserId ?? null) : null,
        }),
        // A rule's conditions are small (a handful at most) — replace wholesale
        // rather than diffing individual condition rows.
        ...(conditions && {
          conditions: {
            deleteMany: {},
            create: conditions.map((c) => ({
              type: c.type,
              matchAccountId: c.type === "account" ? (c.matchAccountId ?? null) : null,
              pattern: c.type === "payee_contains" || c.type === "description_regex" ? (c.pattern ?? null) : null,
              minAmount: c.type === "amount_range" ? (c.minAmount ?? null) : null,
              maxAmount: c.type === "amount_range" ? (c.maxAmount ?? null) : null,
            })),
          },
        }),
      },
      include: ruleInclude,
    });
    return toRuleDTO(rule);
  });

  app.delete("/rules/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.categoryRule.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
