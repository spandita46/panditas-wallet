import type { FastifyInstance } from "fastify";
import {
  createCategorySchema,
  createCategoryRuleSchema,
  updateCategorySchema,
  type CategoryDTO,
  type CategoryKind,
  type CategoryRuleDTO,
  type RuleMatchType,
} from "@panditas/shared";
import type { Category, CategoryRule } from "@prisma/client";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";

function toCategoryDTO(c: Category): CategoryDTO {
  return {
    id: c.id,
    name: c.name,
    group: c.group,
    kind: c.kind as CategoryKind,
    monthlyLimit: c.monthlyLimit === null ? null : Number(c.monthlyLimit),
    color: c.color,
    sortOrder: c.sortOrder,
    archived: c.archived,
  };
}

function toRuleDTO(r: CategoryRule & { category: { name: string }; matchAccount: { name: string; label: string | null } | null }): CategoryRuleDTO {
  return {
    id: r.id,
    categoryId: r.categoryId,
    categoryName: r.category.name,
    matchType: r.matchType as RuleMatchType,
    matchAccountId: r.matchAccountId,
    matchAccountName: r.matchAccount ? (r.matchAccount.label ?? r.matchAccount.name) : null,
    pattern: r.pattern,
    priority: r.priority,
  };
}

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireRole("admin", "adult") }, async () => {
    const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
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
    });
    return reply.code(201).send(toCategoryDTO(category));
  });

  app.patch("/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCategorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Category not found" });
    const category = await prisma.category.update({ where: { id }, data: parsed.data });
    return toCategoryDTO(category);
  });

  // Rules ---------------------------------------------------------------

  app.get("/rules", { preHandler: requireRole("admin", "adult") }, async () => {
    const rules = await prisma.categoryRule.findMany({
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      include: { category: { select: { name: true } }, matchAccount: { select: { name: true, label: true } } },
    });
    return rules.map(toRuleDTO);
  });

  app.post("/rules", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = createCategoryRuleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const rule = await prisma.categoryRule.create({
      data: {
        categoryId: parsed.data.categoryId,
        matchType: parsed.data.matchType,
        matchAccountId: parsed.data.matchType === "account" ? (parsed.data.matchAccountId ?? null) : null,
        pattern: parsed.data.matchType === "account" ? null : (parsed.data.pattern ?? null),
        priority: parsed.data.priority,
      },
      include: { category: { select: { name: true } }, matchAccount: { select: { name: true, label: true } } },
    });
    return reply.code(201).send(toRuleDTO(rule));
  });

  app.delete("/rules/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.categoryRule.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
