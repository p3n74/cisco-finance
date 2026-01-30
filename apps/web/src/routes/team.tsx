import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2, UserPlus, Shield } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PresenceStatusIndicator } from "@/components/presence-status";
import { usePresence } from "@/hooks/usePresence";
import { queryClient, trpc } from "@/utils/trpc";
import { toast } from "sonner";

export const Route = createFileRoute("/team")({
  component: TeamRoute,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({
        to: "/",
        throw: true,
      });
    }
    return { session };
  },
});

const ROLE_LABELS: Record<string, string> = {
  VP_FINANCE: "Vice President for Finance",
  AUDITOR: "Auditor",
  TREASURER: "Treasurer",
  WAYS_AND_MEANS: "Ways and Means Officer",
};

const ROLES = [
  { value: "VP_FINANCE", label: "Vice President for Finance" },
  { value: "AUDITOR", label: "Auditor" },
  { value: "TREASURER", label: "Treasurer" },
  { value: "WAYS_AND_MEANS", label: "Ways and Means Officer" },
];

function TeamRoute() {
  const { session } = Route.useRouteContext();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    email: "",
    role: "AUDITOR",
  });

  const teamQueryOptions = trpc.team.list.queryOptions();
  const teamQuery = useQuery(teamQueryOptions);
  
  const myRoleQueryOptions = trpc.team.getMyRole.queryOptions();
  const myRoleQuery = useQuery(myRoleQueryOptions);
  
  const isVP = myRoleQuery.data?.role === "VP_FINANCE";

  const teamUserIds = (teamQuery.data ?? [])
    .map((u) => u.registeredUser?.id)
    .filter((id): id is string => !!id);
  const { statuses: presenceStatuses } = usePresence(teamUserIds, !!teamQuery.data?.length);

  const addMemberMutation = useMutation(
    trpc.team.add.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: teamQueryOptions.queryKey });
        setFormState({ email: "", role: "AUDITOR" });
        setIsAddDialogOpen(false);
        toast.success("Team member added successfully");
      },
      onError: (err) => {
        toast.error(`Failed to add member: ${err.message}`);
      }
    }),
  );

  const removeMemberMutation = useMutation(
    trpc.team.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: teamQueryOptions.queryKey });
        setConfirmRemoveUserId(null);
        toast.success("Team member removed successfully");
      },
      onError: (err) => {
        toast.error(`Failed to remove member: ${err.message}`);
      }
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.email.trim()) {
      toast.error("Please fill out all required fields.");
      return;
    }
    // @ts-ignore - Role enum typing
    addMemberMutation.mutate(formState);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Management</p>
          <h1 className="text-3xl font-bold tracking-tight">Team & Permissions</h1>
          <p className="text-muted-foreground">
            Manage authorized users and their roles.
          </p>
        </div>
        {isVP && (
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Team Member
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authorized Users</CardTitle>
          <CardDescription>
            These users have access to the finance system based on their roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teamQuery.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading team members...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-border/50 bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Added</th>
                    {isVP && <th className="px-5 py-3 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {teamQuery.data?.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-4">
                        {user.registeredUser ? (
                          <div className="flex items-center gap-3">
                            {user.registeredUser.image ? (
                              <img 
                                src={user.registeredUser.image} 
                                alt={user.registeredUser.name ?? "User"} 
                                className="h-8 w-8 rounded-full bg-muted object-cover" 
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                                {(user.registeredUser.name ?? "U").charAt(0)}
                              </div>
                            )}
                            <span className="font-medium">{user.registeredUser.name ?? "Unknown User"}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Not registered</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{user.email}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          <Shield className="h-3 w-3" />
                          {ROLE_LABELS[user.role] || user.role}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {user.registeredUser ? (
                          <PresenceStatusIndicator
                            status={presenceStatuses[user.registeredUser.id] ?? "offline"}
                            showLabel
                            size="md"
                          />
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                            Pending Signup
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      {isVP && (
                        <td className="px-5 py-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                            onClick={() => setConfirmRemoveUserId(user.id)}
                            disabled={user.role === "VP_FINANCE" && user.email === session.data?.user.email} // Prevent self-delete if VP
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {teamQuery.data?.length === 0 && (
                    <tr>
                      <td colSpan={isVP ? 6 : 5} className="px-5 py-8 text-center text-muted-foreground">
                        No team members found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Authorize a new user by email. They will receive these permissions when they log in.
            </DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="audit@cisco.com"
                value={formState.email}
                onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formState.role}
                onChange={(e) => setFormState({ ...formState, role: e.target.value })}
                required
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={addMemberMutation.isPending}>
                {addMemberMutation.isPending ? "Adding..." : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRemoveUserId}
        onOpenChange={(open) => !open && setConfirmRemoveUserId(null)}
        title="Remove team member"
        description="Are you sure you want to remove this user? They will lose access to the finance system."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (confirmRemoveUserId) {
            removeMemberMutation.mutate({ id: confirmRemoveUserId });
          }
        }}
        loading={removeMemberMutation.isPending}
      />
    </div>
  );
}
